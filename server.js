require("dotenv").config();
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const pdfParse = require("pdf-parse");
const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const QRCode = require("qrcode");
const { ObjectId } = require("mongodb");
const { getDb } = require("./db");
const { extractFieldsFromPages } = require("./utils/extractFields");
const { parseCsv } = require("./utils/csvParser");
const { sendWhatsAppMedia, DEFAULT_RECEIVER_NUMBER } = require("./utils/whatsapp");
const { generateSummaryCanvasImage } = require("./utils/summaryCanvas");

const path = require("path");
const fs = require("fs");
const { createCanvas, GlobalFonts } = require("@napi-rs/canvas");

const fontsDir = path.join(__dirname, "fonts");

const systemFontDirs = [
  fontsDir,
  process.platform === "win32" ? "C:\\Windows\\Fonts" : "",
  "/usr/share/fonts",
  "/usr/share/fonts/truetype",
  "/usr/local/share/fonts",
  "~/.fonts",
].filter((d) => d && fs.existsSync(d));

function initCanvasFonts() {
  const fontPaths = [
    path.join(fontsDir, "Nirmala.ttf"),
    "C:\\Windows\\Fonts\\Nirmala.ttf",
    "C:\\Windows\\Fonts\\Nirmalab.ttf",
  ];
  fontPaths.forEach((fp) => {
    if (fs.existsSync(fp)) {
      try {
        GlobalFonts.registerFromPath(fp, "Nirmala UI");
        console.log(`[FontLoader] Registered canvas font: ${fp}`);
      } catch (e) {
        console.error(`[FontLoader] Failed to register font ${fp}:`, e.message);
      }
    }
  });
}
initCanvasFonts();

const app = express();
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
      "x-user-email",
      "x-internal-secret",
      "x-api-key",
      "x-user-id",
    ],
  })
);
app.options("*", cors());
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));

async function drawTextOrImageLine(page, srcDoc, text, x, y, size, font, color, imageCache = null) {
  const isUnicode = /[^\x00-\x7F]/.test(text);

  if (isUnicode) {
    try {
      const cacheKey = `${text}_${size}`;
      let cached = imageCache ? imageCache.get(cacheKey) : null;

      if (!cached) {
        const scaleFactor = 4; // High DPI (300+ DPI) for crisp thermal printing
        const fontSizePx = Math.round(size * scaleFactor);

        const tempCanvas = createCanvas(10, 10);
        const tempCtx = tempCanvas.getContext("2d");
        const fontStyle = `bold ${fontSizePx}px "Nirmala UI", "Segoe UI", sans-serif`;
        tempCtx.font = fontStyle;
        const metrics = tempCtx.measureText(text);

        const padX = Math.ceil(4 * scaleFactor);
        const padY = Math.ceil(4 * scaleFactor);
        const canvasWidth = Math.max(100, Math.ceil(metrics.width + padX * 2));
        const canvasHeight = Math.max(20, Math.ceil(fontSizePx * 1.5 + padY * 2));

        const canvas = createCanvas(canvasWidth, canvasHeight);
        const ctx = canvas.getContext("2d");

        ctx.font = fontStyle;
        ctx.fillStyle = "#000000";
        ctx.textBaseline = "middle";
        ctx.fillText(text, padX, canvasHeight / 2);

        const pngBuffer = canvas.toBuffer("image/png");
        const pngImg = await srcDoc.embedPng(pngBuffer);

        const renderHeight = canvasHeight / scaleFactor;
        const renderWidth = canvasWidth / scaleFactor;

        cached = {
          pngImg,
          renderWidth,
          renderHeight,
          padX: padX / scaleFactor,
          padY: padY / scaleFactor,
        };
        if (imageCache) {
          imageCache.set(cacheKey, cached);
        }
      }

      page.drawImage(cached.pngImg, {
        x: x - cached.padX,
        y: y - 1,
        width: cached.renderWidth,
        height: cached.renderHeight,
      });
      return;
    } catch (e) {
      console.error("Canvas Indic text render error:", e);
      text = text.replace(/[^\x00-\x7F]/g, "");
    }
  }

  if (text.trim()) {
    page.drawText(text, {
      x,
      y,
      size,
      font,
      color: color || rgb(0, 0, 0),
    });
  }
}


// Helper to get authenticated user email from header or query or body
function getUserEmail(req) {
  if (!req) return "";
  return (
    (req.headers && req.headers["x-user-email"]) ||
    (req.query && req.query.email) ||
    (req.body && req.body.email) ||
    ""
  ).toString().toLowerCase().trim();
}

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    version: "1.0.5-pdf-fallback-fix",
    fontDirsConfigured: systemFontDirs.length,
    message: "LABCOM Backend is live and healthy!",
  });
});

app.get("/api/health", (req, res) =>
  res.json({
    ok: true,
    version: "1.0.5-pdf-fallback-fix",
    fontDirsConfigured: systemFontDirs.length,
  })
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024, fieldSize: 100 * 1024 * 1024 }, // 100 MB
});

// ---- helpers -------------------------------------------------------------

async function getPerPageText(buffer, startPage = 1, endPage = null) {
  const pageTexts = [];
  let pageIdx = 0;
  try {
    await pdfParse(buffer, {
      pagerender: async (pageData) => {
        pageIdx++;
        if (pageIdx >= startPage && (!endPage || pageIdx <= endPage)) {
          try {
            const textContent = await pageData.getTextContent();
            const text = (textContent && Array.isArray(textContent.items))
              ? textContent.items.map((i) => (i && typeof i.str === "string") ? i.str : "").join("\n")
              : "";
            pageTexts.push(text);
            return text;
          } catch (pe) {
            console.warn(`[getPerPageText] Page ${pageIdx} text extraction error:`, pe.message);
            pageTexts.push("");
            return "";
          }
        }
        return "";
      },
    });
  } catch (err) {
    console.error("[getPerPageText] pdfParse failed:", err.message);
    try {
      const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
      const totalPages = pdfDoc.getPageCount();
      const startP = Math.max(1, startPage);
      const endP = endPage ? Math.min(totalPages, endPage) : totalPages;
      const fallbackCount = Math.max(0, endP - startP + 1);
      for (let i = 0; i < fallbackCount; i++) {
        pageTexts.push("");
      }
    } catch (fallbackErr) {
      console.error("[getPerPageText] pdf-lib fallback failed:", fallbackErr.message);
    }
  }
  return pageTexts;
}

function fillTemplate(template, data) {
  return template.replace(/\{(\w+)\}/g, (m, key) =>
    data[key] !== undefined && data[key] !== null ? String(data[key]) : ""
  );
}

function parseDdMmYyyy(str) {
  const m = (str || "").match(/(\d{2})[.\/](\d{2})[.\/](\d{4})/);
  if (!m) return 0;
  return new Date(`${m[3]}-${m[2]}-${m[1]}`).getTime();
}

function cleanWinAnsi(str) {
  if (!str) return "";
  return str.trim();
}

function getTextWidthSafe(font, text, fontSize) {
  try {
    const asciiEquivalent = text.replace(/[^\x00-\x7F]/g, "A");
    return font.widthOfTextAtSize(asciiEquivalent, fontSize);
  } catch (e) {
    return text.length * fontSize * 0.6;
  }
}

function wrapText(text, maxWidth, font, fontSize) {
  if (!text) return [];
  const rawLines = text.split("\n");
  const wrappedLines = [];

  for (const rawLine of rawLines) {
    const clean = rawLine ? rawLine.trim() : "";
    if (!clean) {
      wrappedLines.push("");
      continue;
    }

    if (maxWidth <= 0) {
      wrappedLines.push(clean);
      continue;
    }

    const words = clean.split(/\s+/);
    let currentLine = "";

    for (const word of words) {
      if (!word) continue;

      const wordWidth = getTextWidthSafe(font, word, fontSize);

      // If a single word or URL exceeds maxWidth by itself
      if (wordWidth > maxWidth) {
        if (currentLine) {
          wrappedLines.push(currentLine);
          currentLine = "";
        }
        let piece = "";
        const chars = Array.from(word);
        for (const char of chars) {
          if (getTextWidthSafe(font, piece + char, fontSize) <= maxWidth) {
            piece += char;
          } else {
            if (piece) wrappedLines.push(piece);
            piece = char;
          }
        }
        currentLine = piece;
        continue;
      }

      // Normal word that fits within maxWidth
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const testWidth = getTextWidthSafe(font, testLine, fontSize);

      if (testWidth <= maxWidth) {
        currentLine = testLine;
      } else {
        if (currentLine) {
          wrappedLines.push(currentLine);
        }
        currentLine = word;
      }
    }

    if (currentLine) {
      wrappedLines.push(currentLine);
    }
  }

  return wrappedLines;
}

// Default templates seed
const DEFAULT_TEMPLATES = [
  {
    name: "Meesho Store Follower Booster",
    description: "Encodes Meesho store page with Order No & SKU to grow followers and repeat orders.",
    enableQr: true,
    qrText: "https://www.meesho.com/themahirenterprise",
    detailText: "Scan to Follow Meesho Store!\nOrder: {orderNo}\nSKU: {sku}",
    qrX: 30,
    qrY: 30,
    qrSize: 90,
    fontSize: 8,
    sortBy: "sku",
    sortOrder: "asc",
  },
  {
    name: "Instagram Direct QR Stamp",
    description: "Directs customers to Instagram profile to claim warranty or discount coupons.",
    enableQr: true,
    qrText: "https://instagram.com/mahir.enterprise_",
    detailText: "Scan to Follow on Instagram!\n@mahir.enterprise_\nSKU: {sku}",
    qrX: 95,
    qrY: 30,
    qrSize: 85,
    fontSize: 8,
    sortBy: "sku",
    sortOrder: "asc",
  },
  {
    name: "Pure Multi-Field Sorter (No QR)",
    description: "Cleans and sorts high-volume batch labels strictly by SKU and highest Quantity first.",
    enableQr: false,
    qrText: "{orderNo}",
    detailText: "Order: {orderNo}\nSKU: {sku}",
    qrX: 30,
    qrY: 30,
    qrSize: 90,
    fontSize: 8,
    sortBy: "sku",
    sortOrder: "asc",
  },
];

// ---- CUSTOMER DB SAVE & ANALYSIS ENGINE ----------------------------------

async function saveCustomerOrders(fields, userEmail = "guest") {
  if (!Array.isArray(fields) || fields.length === 0) return;
  try {
    const db = await getDb();
    const customersCol = db.collection("customers");
    const ordersCol = db.collection("orders");

    const activeEmail = (userEmail || "guest").toLowerCase().trim();

    // 1. Prepare items
    const validItems = [];
    const orderNos = new Set();
    const custKeys = new Set();

    for (const item of fields) {
      const custName = (item.customerName || "").trim();
      const mobile = (item.mobileNumber || "").trim();
      const address = (item.customerAddress || custName).trim();
      const orderNo = (item.orderNo || "").trim();
      const subOrderNo = (item.subOrderNo || orderNo).trim();
      const paymentType = (item.paymentType || "COD").trim();
      const orderDate = item.orderDate || new Date().toISOString().slice(0, 10);
      const sku = (item.sku || "").trim();
      const qty = parseInt(item.qty, 10) || 1;
      const state = (item.state || "India").trim();

      if (!custName && !orderNo && !mobile) continue;

      let custKey = "";
      if (mobile && mobile.length >= 10) {
        custKey = `phone:${mobile}`;
      } else if (custName && custName.length > 2) {
        custKey = `name:${custName.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
      } else if (orderNo) {
        custKey = `order:${orderNo}`;
      } else {
        continue;
      }

      validItems.push({
        custName,
        mobile,
        address,
        orderNo,
        subOrderNo,
        paymentType,
        orderDate,
        sku,
        qty,
        state,
        custKey,
      });

      if (orderNo) {
        orderNos.add(orderNo);
        orderNos.add(subOrderNo);
      }
      custKeys.add(custKey);
    }

    if (validItems.length === 0) return;

    // 2. Batch fetch existing orders & customers
    const existingOrdersArray = orderNos.size > 0
      ? await ordersCol.find({ $or: [{ orderNo: { $in: Array.from(orderNos) } }, { subOrderNo: { $in: Array.from(orderNos) } }] }).toArray()
      : [];
    const existingOrderSet = new Set();
    existingOrdersArray.forEach(o => {
      if (o.orderNo) existingOrderSet.add(o.orderNo);
      if (o.subOrderNo) existingOrderSet.add(o.subOrderNo);
    });

    const existingCustomersArray = custKeys.size > 0
      ? await customersCol.find({ custKey: { $in: Array.from(custKeys) } }).toArray()
      : [];
    const customerMap = new Map();
    existingCustomersArray.forEach(c => customerMap.set(c.custKey, c));

    const orderOps = [];
    const customerOps = [];

    // Memory tracking for customer updates during this batch
    const localCustomerState = new Map();

    for (const item of validItems) {
      // Order insert
      if (item.orderNo && !existingOrderSet.has(item.orderNo) && !existingOrderSet.has(item.subOrderNo)) {
        existingOrderSet.add(item.orderNo);
        existingOrderSet.add(item.subOrderNo);
        orderOps.push({
          insertOne: {
            document: {
              orderNo: item.orderNo,
              subOrderNo: item.subOrderNo,
              paymentType: item.paymentType,
              customerName: item.custName,
              customerMobile: item.mobile,
              customerAddress: item.address,
              state: item.state,
              orderDate: item.orderDate,
              sku: item.sku,
              qty: item.qty,
              userEmail: activeEmail,
              createdAt: new Date(),
            },
          },
        });
      }

      // Customer update / insert
      let custRecord = localCustomerState.get(item.custKey) || customerMap.get(item.custKey);
      const newOrderObj = {
        orderNo: item.orderNo,
        subOrderNo: item.subOrderNo,
        paymentType: item.paymentType,
        orderDate: item.orderDate,
        sku: item.sku,
        qty: item.qty,
        state: item.state,
        address: item.address,
        processedAt: new Date(),
      };

      if (custRecord) {
        const isDuplicateOrder = item.orderNo
          ? (custRecord.orders || []).some((o) => o.orderNo === item.orderNo || (o.subOrderNo && o.subOrderNo === item.subOrderNo))
          : false;

        if (!isDuplicateOrder) {
          const updatedOrders = [...(custRecord.orders || []), newOrderObj];
          const updatedRecord = {
            ...custRecord,
            name: item.custName || custRecord.name,
            mobileNumber: item.mobile || custRecord.mobileNumber,
            address: item.address || custRecord.address,
            state: item.state || custRecord.state,
            orderCount: updatedOrders.length,
            orders: updatedOrders,
            lastOrderDate: item.orderDate,
            updatedAt: new Date(),
            userEmail: activeEmail,
          };
          localCustomerState.set(item.custKey, updatedRecord);
        }
      } else {
        const newCustRecord = {
          custKey: item.custKey,
          userEmail: activeEmail,
          name: item.custName || "Unknown Customer",
          mobileNumber: item.mobile,
          address: item.address,
          state: item.state,
          orderCount: 1,
          orders: [newOrderObj],
          firstOrderDate: item.orderDate,
          lastOrderDate: item.orderDate,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        localCustomerState.set(item.custKey, newCustRecord);
      }
    }

    // Prepare customer operations
    for (const [custKey, custData] of localCustomerState.entries()) {
      if (custData._id) {
        customerOps.push({
          updateOne: {
            filter: { _id: custData._id },
            update: {
              $set: {
                name: custData.name,
                mobileNumber: custData.mobileNumber,
                address: custData.address,
                state: custData.state,
                orderCount: custData.orderCount,
                orders: custData.orders,
                lastOrderDate: custData.lastOrderDate,
                updatedAt: new Date(),
                userEmail: activeEmail,
              },
            },
          },
        });
      } else {
        customerOps.push({
          insertOne: {
            document: custData,
          },
        });
      }
    }

    if (orderOps.length > 0) {
      await ordersCol.bulkWrite(orderOps, { ordered: false });
    }
    if (customerOps.length > 0) {
      await customersCol.bulkWrite(customerOps, { ordered: false });
    }
  } catch (err) {
    console.error("Error saving customer orders to MongoDB:", err.message);
  }
}

// ---- PINCODE & DISTRICT DETECTION ENGINE -----------------------------------------

const PINCODE_PREFIX_MAP = {
  // GUJARAT (36xxxx - 39xxxx)
  "395": { district: "Surat", state: "Gujarat" },
  "394": { district: "Surat", state: "Gujarat" },
  "380": { district: "Ahmedabad", state: "Gujarat" },
  "382": { district: "Gandhinagar", state: "Gujarat" },
  "390": { district: "Vadodara", state: "Gujarat" },
  "391": { district: "Vadodara", state: "Gujarat" },
  "360": { district: "Rajkot", state: "Gujarat" },
  "364": { district: "Bhavnagar", state: "Gujarat" },
  "361": { district: "Jamnagar", state: "Gujarat" },
  "362": { district: "Junagadh", state: "Gujarat" },
  "388": { district: "Anand", state: "Gujarat" },
  "396": { district: "Valsad / Navsari", state: "Gujarat" },
  "393": { district: "Bharuch", state: "Gujarat" },
  "392": { district: "Bharuch", state: "Gujarat" },
  "363": { district: "Surendranagar / Morbi", state: "Gujarat" },
  "384": { district: "Mehsana / Patan", state: "Gujarat" },
  "385": { district: "Banaskantha", state: "Gujarat" },
  "383": { district: "Sabarkantha", state: "Gujarat" },
  "387": { district: "Kheda / Nadiad", state: "Gujarat" },
  "389": { district: "Panchmahal / Godhra", state: "Gujarat" },
  "370": { district: "Kutch / Bhuj", state: "Gujarat" },
  "365": { district: "Amreli", state: "Gujarat" },
  "369": { district: "Porbandar", state: "Gujarat" },

  // MAHARASHTRA (40xxxx - 44xxxx)
  "400": { district: "Mumbai", state: "Maharashtra" },
  "401": { district: "Thane / Palghar", state: "Maharashtra" },
  "410": { district: "Pune / Raigad", state: "Maharashtra" },
  "411": { district: "Pune", state: "Maharashtra" },
  "412": { district: "Pune", state: "Maharashtra" },
  "440": { district: "Nagpur", state: "Maharashtra" },
  "441": { district: "Nagpur", state: "Maharashtra" },
  "422": { district: "Nashik", state: "Maharashtra" },
  "431": { district: "Aurangabad", state: "Maharashtra" },
  "413": { district: "Solapur", state: "Maharashtra" },
  "416": { district: "Kolhapur / Sangli", state: "Maharashtra" },
  "444": { district: "Akola / Amravati", state: "Maharashtra" },
  "435": { district: "Latur", state: "Maharashtra" },
  "424": { district: "Dhule / Jalgaon", state: "Maharashtra" },
  "415": { district: "Satara", state: "Maharashtra" },

  // TAMIL NADU (60xxxx - 64xxxx)
  "600": { district: "Chennai", state: "Tamil Nadu" },
  "601": { district: "Thiruvallur / Kancheepuram", state: "Tamil Nadu" },
  "602": { district: "Kancheepuram", state: "Tamil Nadu" },
  "641": { district: "Coimbatore / Tiruppur", state: "Tamil Nadu" },
  "625": { district: "Madurai", state: "Tamil Nadu" },
  "620": { district: "Tiruchirappalli (Trichy)", state: "Tamil Nadu" },
  "636": { district: "Salem", state: "Tamil Nadu" },
  "632": { district: "Vellore", state: "Tamil Nadu" },
  "638": { district: "Erode", state: "Tamil Nadu" },
  "627": { district: "Tirunelveli", state: "Tamil Nadu" },
  "624": { district: "Dindigul", state: "Tamil Nadu" },
  "613": { district: "Thanjavur", state: "Tamil Nadu" },
  "612": { district: "Kumbakonam", state: "Tamil Nadu" },
  "628": { district: "Tuticorin (Thoothukudi)", state: "Tamil Nadu" },
  "607": { district: "Cuddalore", state: "Tamil Nadu" },

  // KARNATAKA (56xxxx - 59xxxx)
  "560": { district: "Bengaluru", state: "Karnataka" },
  "561": { district: "Bengaluru Rural", state: "Karnataka" },
  "562": { district: "Bengaluru Rural", state: "Karnataka" },
  "570": { district: "Mysuru", state: "Karnataka" },
  "580": { district: "Hubballi-Dharwad", state: "Karnataka" },
  "575": { district: "Mangaluru", state: "Karnataka" },
  "590": { district: "Belagavi", state: "Karnataka" },
  "585": { district: "Kalaburagi", state: "Karnataka" },
  "577": { district: "Davanagere", state: "Karnataka" },
  "583": { district: "Ballari", state: "Karnataka" },
  "572": { district: "Tumakuru", state: "Karnataka" },
  "576": { district: "Udupi", state: "Karnataka" },

  // KERALA (67xxxx - 69xxxx)
  "682": { district: "Kochi (Ernakulam)", state: "Kerala" },
  "695": { district: "Thiruvananthapuram", state: "Kerala" },
  "673": { district: "Kozhikode", state: "Kerala" },
  "680": { district: "Thrissur", state: "Kerala" },
  "670": { district: "Kannur", state: "Kerala" },
  "691": { district: "Kollam", state: "Kerala" },
  "688": { district: "Alappuzha", state: "Kerala" },
  "678": { district: "Palakkad", state: "Kerala" },
  "676": { district: "Malappuram", state: "Kerala" },
  "686": { district: "Kottayam", state: "Kerala" },

  // TELANGANA & ANDHRA PRADESH (50xxxx - 53xxxx)
  "500": { district: "Hyderabad", state: "Telangana" },
  "501": { district: "Rangareddy", state: "Telangana" },
  "506": { district: "Warangal", state: "Telangana" },
  "503": { district: "Nizamabad", state: "Telangana" },
  "507": { district: "Khammam", state: "Telangana" },
  "505": { district: "Karimnagar", state: "Telangana" },
  "530": { district: "Visakhapatnam", state: "Andhra Pradesh" },
  "520": { district: "Vijayawada", state: "Andhra Pradesh" },
  "522": { district: "Guntur", state: "Andhra Pradesh" },
  "524": { district: "Nellore", state: "Andhra Pradesh" },
  "518": { district: "Kurnool", state: "Andhra Pradesh" },
  "533": { district: "Rajahmundry / Kakinada", state: "Andhra Pradesh" },
  "517": { district: "Tirupati / Chittoor", state: "Andhra Pradesh" },
  "516": { district: "Kadapa", state: "Andhra Pradesh" },

  // WEST BENGAL (70xxxx - 74xxxx)
  "700": { district: "Kolkata", state: "West Bengal" },
  "711": { district: "Howrah", state: "West Bengal" },
  "713": { district: "Durgapur / Bardhaman", state: "West Bengal" },
  "734": { district: "Siliguri / Darjeeling", state: "West Bengal" },
  "732": { district: "Malda", state: "West Bengal" },
  "721": { district: "Kharagpur", state: "West Bengal" },
  "712": { district: "Hooghly", state: "West Bengal" },
  "741": { district: "Nadia", state: "West Bengal" },

  // ODISHA (75xxxx - 77xxxx)
  "751": { district: "Bhubaneswar", state: "Odisha" },
  "753": { district: "Cuttack", state: "Odisha" },
  "769": { district: "Rourkela", state: "Odisha" },
  "760": { district: "Berhampur", state: "Odisha" },
  "768": { district: "Sambalpur", state: "Odisha" },
  "752": { district: "Puri", state: "Odisha" },
  "756": { district: "Balasore", state: "Odisha" },

  // ASSAM (78xxxx - 79xxxx)
  "781": { district: "Guwahati", state: "Assam" },
  "788": { district: "Silchar", state: "Assam" },
  "786": { district: "Dibrugarh", state: "Assam" },
  "785": { district: "Jorhat / Sivasagar", state: "Assam" },
  "782": { district: "Nagaon", state: "Assam" },
  "784": { district: "Lakhimpur / Tezpur", state: "Assam" },

  // PUNJAB (14xxxx - 16xxxx)
  "141": { district: "Ludhiana", state: "Punjab" },
  "143": { district: "Amritsar", state: "Punjab" },
  "144": { district: "Jalandhar", state: "Punjab" },
  "147": { district: "Patiala", state: "Punjab" },
  "151": { district: "Bathinda", state: "Punjab" },
  "160": { district: "Mohali / Chandigarh", state: "Punjab" },

  // RAJASTHAN (30xxxx - 34xxxx)
  "302": { district: "Jaipur", state: "Rajasthan" },
  "342": { district: "Jodhpur", state: "Rajasthan" },
  "324": { district: "Kota", state: "Rajasthan" },
  "334": { district: "Bikaner", state: "Rajasthan" },
  "305": { district: "Ajmer", state: "Rajasthan" },
  "313": { district: "Udaipur", state: "Rajasthan" },
  "311": { district: "Bhilwara", state: "Rajasthan" },
  "301": { district: "Alwar", state: "Rajasthan" },
  "332": { district: "Sikar", state: "Rajasthan" },

  // GOA (403xxx)
  "403": { district: "Panaji / North Goa", state: "Goa" },

  // DELHI NCR & NORTH (11xxxx & 201xxx & 122xxx)
  "110": { district: "New Delhi", state: "Delhi" },
  "201": { district: "Noida / Ghaziabad", state: "Uttar Pradesh" },
  "122": { district: "Gurugram", state: "Haryana" },
  "121": { district: "Faridabad / Meerut", state: "Haryana / UP" },
  "226": { district: "Lucknow", state: "Uttar Pradesh" },
  "208": { district: "Kanpur", state: "Uttar Pradesh" },
  "221": { district: "Varanasi", state: "Uttar Pradesh" },
  "211": { district: "Prayagraj", state: "Uttar Pradesh" },
  "250": { district: "Meerut", state: "Uttar Pradesh" },
  "282": { district: "Agra", state: "Uttar Pradesh" },

  // BIHAR & JHARKHAND (80xxxx - 83xxxx)
  "800": { district: "Patna", state: "Bihar" },
  "834": { district: "Ranchi", state: "Jharkhand" },
  "831": { district: "Jamshedpur", state: "Jharkhand" },
  "826": { district: "Dhanbad", state: "Jharkhand" },
  "842": { district: "Muzaffarpur", state: "Bihar" },
  "812": { district: "Bhagalpur", state: "Bihar" },

  // MADHYA PRADESH & CHHATTISGARH (45xxxx - 49xxxx)
  "452": { district: "Indore", state: "Madhya Pradesh" },
  "462": { district: "Bhopal", state: "Madhya Pradesh" },
  "482": { district: "Jabalpur", state: "Madhya Pradesh" },
  "474": { district: "Gwalior", state: "Madhya Pradesh" },
  "492": { district: "Raipur", state: "Chhattisgarh" },
  "490": { district: "Bhilai", state: "Chhattisgarh" },
};

const DISTRICTS_MAP = {
  Gujarat: ["Surat", "Ahmedabad", "Vadodara", "Rajkot", "Gandhinagar", "Bhavnagar", "Jamnagar", "Junagadh", "Anand", "Navsari", "Morbi", "Mehsana", "Bharuch", "Valsad", "Vapi", "Kheda", "Patan", "Porbandar", "Amreli", "Surendranagar", "Botad", "Dahod", "Godhra", "Gir Somnath", "Mahisagar", "Narmada", "Tapi", "Aravalli", "Banaskantha", "Sabarkantha", "Kutch", "Bhuj"],
  Maharashtra: ["Mumbai", "Pune", "Nagpur", "Thane", "Nashik", "Aurangabad", "Solapur", "Amravati", "Kolhapur", "Navi Mumbai", "Akola", "Latur", "Dhule", "Satara", "Sangli", "Nanded", "Jalgaon", "Ratnagiri", "Palghar", "Raigad", "Ahmednagar", "Chandrapur", "Parbhani", "Beed", "Yavatmal", "Bhandara", "Gondia"],
  TamilNadu: ["Chennai", "Coimbatore", "Madurai", "Tiruchirappalli", "Trichy", "Salem", "Tiruppur", "Vellore", "Erode", "Tirunelveli", "Kancheepuram", "Dindigul", "Thanjavur", "Tuticorin", "Thoothukudi", "Cuddalore", "Kumbakonam", "Karur", "Nagapattinam", "Namakkal", "Kanyakumari"],
  Karnataka: ["Bengaluru", "Bangalore", "Mysuru", "Mysore", "Hubli", "Dharwad", "Mangalore", "Mangaluru", "Belgaum", "Belagavi", "Gulbarga", "Kalaburagi", "Davanagere", "Bellary", "Ballari", "Shimoga", "Shivamogga", "Tumkur", "Udupi", "Hassan", "Bidar", "Raichur"],
  Kerala: ["Kochi", "Cochin", "Thiruvananthapuram", "Trivandrum", "Kozhikode", "Calicut", "Thrissur", "Kannur", "Kollam", "Alappuzha", "Palakkad", "Malappuram", "Kottayam", "Idukki", "Wayanad", "Kasaragod", "Pathanamthitta"],
  Punjab: ["Ludhiana", "Amritsar", "Jalandhar", "Patiala", "Bathinda", "Mohali", "Hoshiarpur", "Batala", "Pathankot", "Firozpur", "Moga", "Abohar", "Malerkotla", "Khanna", "Phagwara"],
  Rajasthan: ["Jaipur", "Jodhpur", "Kota", "Bikaner", "Ajmer", "Udaipur", "Bhilwara", "Alwar", "Sikar", "Pali", "Jhunjhunu", "Churu", "Barmer", "Nagaur", "Bharatpur", "Ganganagar"],
  Assam: ["Guwahati", "Silchar", "Dibrugarh", "Jorhat", "Nagaon", "Tinsukia", "Tezpur", "Lakhimpur", "Kamrup", "Cachar", "Barpeta", "Darrang", "Dhubri", "Golaghat", "Hailakandi", "Karimganj", "Morigaon", "Sivasagar", "Sonitpur"],
  WestBengal: ["Kolkata", "Calcutta", "Howrah", "Durgapur", "Asansol", "Siliguri", "Bardhaman", "Malda", "Kharagpur", "Hooghly", "Nadia", "Murshidabad", "Darjeeling", "Jalpaiguri", "Midnapore"],
  Telangana: ["Hyderabad", "Secunderabad", "Warangal", "Nizamabad", "Khammam", "Karimnagar", "Ramagundam", "Suryapet", "Mahbubnagar", "Nalgonda"],
  AndhraPradesh: ["Visakhapatnam", "Vizag", "Vijayawada", "Guntur", "Nellore", "Kurnool", "Rajahmundry", "Tirupati", "Kadapa", "Kakinada", "Eluru", "Anantapur", "Vizianagaram"],
  Odisha: ["Bhubaneswar", "Cuttack", "Rourkela", "Berhampur", "Sambalpur", "Puri", "Balasore", "Bhadrak", "Baripada", "Jharsuguda"],
  Goa: ["Panaji", "Panjim", "Margao", "Vasco", "Mapusa", "Ponda", "Bicholim", "Curchorem", "South Goa", "North Goa"],
};

function detectDistrict(address = "", state = "") {
  if (!address) return "Central";

  // 1. PINCODE Lookup (Highest Accuracy for all Indian Regions)
  const pinMatch = address.match(/\b([1-8]\d{5})\b/);
  if (pinMatch) {
    const pin = pinMatch[1];
    const p3 = pin.substring(0, 3);
    if (PINCODE_PREFIX_MAP[p3]) {
      return PINCODE_PREFIX_MAP[p3].district;
    }
  }

  // 2. City / District Dictionary Search
  const upperAddr = address.toUpperCase();
  const stateKey = Object.keys(DISTRICTS_MAP).find(
    (k) => k.toLowerCase() === (state || "").toLowerCase().replace(/\s+/g, "")
  );

  const distList = stateKey ? DISTRICTS_MAP[stateKey] : Object.values(DISTRICTS_MAP).flat();

  for (const dist of distList) {
    const reg = new RegExp(`\\b${dist.toUpperCase()}\\b`, "i");
    if (reg.test(upperAddr)) {
      return dist;
    }
  }

  // 3. Token Parsing Fallback
  const parts = address.split(/[,;\n]+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const candidate = parts[parts.length - 2].replace(/\d+/g, "").trim();
    if (candidate.length > 2 && candidate.length < 25) {
      return candidate;
    }
  }
  return "Central";
}

// GET /api/customer-analysis
app.get("/api/customer-analysis", async (req, res) => {
  try {
    const db = await getDb();
    const customersCol = db.collection("customers");
    const search = (req.query.search || "").trim().toLowerCase();
    const repeatOnly = req.query.repeatOnly === "true";
    const selectedState = (req.query.state || "").trim();
    const selectedDistrict = (req.query.district || "").trim();

    let allCustomers = await customersCol.find({}).sort({ orderCount: -1, updatedAt: -1 }).toArray();

    // Attach detected district to all customer objects
    allCustomers.forEach((c) => {
      c.district = c.district || detectDistrict(c.address, c.state);
    });

    // 1. Calculate state order counts
    const stateCountsMap = {};
    allCustomers.forEach((c) => {
      const st = (c.state || "India").trim();
      const cnt = c.orderCount || c.orders?.length || 1;
      stateCountsMap[st] = (stateCountsMap[st] || 0) + cnt;
    });

    const allStatesWithCounts = Object.keys(stateCountsMap)
      .map((st) => ({
        name: st,
        count: stateCountsMap[st],
        label: `${st} (${stateCountsMap[st]})`,
      }))
      .sort((a, b) => b.count - a.count);

    const totalOrdersAll = Object.values(stateCountsMap).reduce((a, b) => a + b, 0);

    // 2. Filter by State first
    let stateFilteredCustomers = [...allCustomers];
    if (selectedState && selectedState.toUpperCase() !== "ALL") {
      stateFilteredCustomers = stateFilteredCustomers.filter(
        (c) => (c.state || "").toLowerCase() === selectedState.toLowerCase()
      );
    }

    // 3. Calculate district order counts for the selected state
    const districtCountsMap = {};
    stateFilteredCustomers.forEach((c) => {
      const dist = (c.district || "Central").trim();
      const cnt = c.orderCount || c.orders?.length || 1;
      districtCountsMap[dist] = (districtCountsMap[dist] || 0) + cnt;
    });

    const allDistrictsWithCounts = Object.keys(districtCountsMap)
      .map((dist) => ({
        name: dist,
        count: districtCountsMap[dist],
        label: `${dist} (${districtCountsMap[dist]})`,
      }))
      .sort((a, b) => b.count - a.count);

    const totalOrdersForSelectedState = Object.values(districtCountsMap).reduce((a, b) => a + b, 0);

    // 4. Filter by District if specified
    let customers = [...stateFilteredCustomers];
    if (selectedDistrict && selectedDistrict.toUpperCase() !== "ALL") {
      customers = customers.filter(
        (c) => (c.district || "").toLowerCase() === selectedDistrict.toLowerCase()
      );
    }

    const totalCustomers = customers.length;
    const repeatCustomersCount = customers.filter((c) => (c.orderCount || 1) > 1).length;
    const repeatRate = totalCustomers > 0 ? ((repeatCustomersCount / totalCustomers) * 100).toFixed(1) : 0;
    const totalOrdersProcessed = customers.reduce((sum, c) => sum + (c.orderCount || 1), 0);

    if (search) {
      customers = customers.filter((c) => {
        const nameMatch = (c.name || "").toLowerCase().includes(search);
        const mobMatch = (c.mobileNumber || "").toLowerCase().includes(search);
        const addrMatch = (c.address || "").toLowerCase().includes(search);
        const stateMatch = (c.state || "").toLowerCase().includes(search);
        const distMatch = (c.district || "").toLowerCase().includes(search);
        const orderMatch = c.orders?.some((o) => (o.orderNo || "").toLowerCase().includes(search));
        return nameMatch || mobMatch || addrMatch || stateMatch || distMatch || orderMatch;
      });
    }

    if (repeatOnly) {
      customers = customers.filter((c) => (c.orderCount || 1) > 1);
    }

    const formattedList = customers
      .map((c) => {
        const cnt = c.orderCount || c.orders?.length || 1;
        return {
          id: c._id.toString(),
          name: c.name || "Customer",
          mobileNumber: c.mobileNumber || "N/A",
          address: c.address || "N/A",
          state: c.state || "India",
          district: c.district || "Central",
          orderCount: cnt,
          isRepeat: cnt > 1,
          firstOrderDate: c.firstOrderDate || "",
          lastOrderDate: c.lastOrderDate || "",
          ordersCountText: cnt > 1 ? `${cnt} Orders` : "1 Order",
          orders: c.orders || [],
        };
      })
      .sort((a, b) => b.orderCount - a.orderCount);

    res.json({
      summary: {
        totalCustomers,
        repeatCustomersCount,
        repeatRate,
        totalOrdersProcessed,
        totalOrdersAll,
        totalOrdersForSelectedState,
        allStatesWithCounts: allStatesWithCounts || [],
        allDistrictsWithCounts: allDistrictsWithCounts || [],
      },
      customers: formattedList,
    });
  } catch (err) {
    console.error("Customer Analysis API Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/customer-analysis/history
app.get("/api/customer-analysis/history", async (req, res) => {
  try {
    const db = await getDb();
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: "Customer ID is required" });

    const customersCol = db.collection("customers");
    const customer = await customersCol.findOne({ _id: new ObjectId(id) });
    if (!customer) return res.status(404).json({ error: "Customer not found" });

    res.json({
      id: customer._id.toString(),
      name: customer.name,
      mobileNumber: customer.mobileNumber || "N/A",
      address: customer.address || "N/A",
      state: customer.state || "India",
      orderCount: customer.orderCount || 1,
      orders: customer.orders || [],
    });
  } catch (err) {
    console.error("Customer History API Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---- RETURNS & REVERSE LOGISTICS ENGINE -----------------------------------

// 1. POST /api/returns/upload - Parse CSV & upsert return entries into DB
app.post("/api/returns/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: "CSV file is required" });
    }

    const csvContent = req.file.buffer.toString("utf-8");
    const rawRows = parseCsv(csvContent);

    if (!rawRows || rawRows.length === 0) {
      return res.status(400).json({ error: "No valid rows found in the CSV file" });
    }

    const activeEmail = getUserEmail(req) || "guest";
    const db = await getDb();
    const returnsCol = db.collection("returns");
    const ordersCol = db.collection("orders");

    const validReturns = [];
    const subOrderNos = new Set();
    const orderNos = new Set();

    for (const row of rawRows) {
      const subOrderNo = (
        row["Suborder Number"] ||
        row["Suborder No"] ||
        row["Sub Order ID"] ||
        row["Sub Order No"] ||
        row["Order Number"] ||
        ""
      ).trim();

      const orderNo = (
        row["Order Number"] ||
        row["Order No"] ||
        (subOrderNo ? subOrderNo.split("_")[0] : "")
      ).trim();

      if (!subOrderNo && !orderNo) continue;

      const sku = (row["SKU"] || "").trim();
      const productName = (row["Product Name"] || "").trim();
      const qty = parseInt(row["Qty"] || "1", 10) || 1;
      const returnType = (row["Type of Return"] || row["Return Type"] || "Return").trim();
      const subType = (row["Sub Type"] || "").trim();
      const dispatchDate = (row["Dispatch Date"] || "").trim();
      const returnCreatedDate = (row["Return Created Date"] || row["Return Date"] || "").trim();
      const deliveredDate = (row["Delivered Date"] || "").trim();
      const courierPartner = (row["Courier Partner"] || row["Courier"] || "").trim();
      const awbNumber = (row["AWB Number"] || row["AWB"] || "").trim();
      const trackingLink = (row["Tracking Link"] || "").trim();
      const proofOfDelivery = (row["Proof of Delivery"] || "").trim();
      const returnReason = (row["Return Reason"] || row["Reason"] || "N/A").trim();
      const detailedReturnReason = (row["Detailed Return Reason"] || "").trim();

      validReturns.push({
        subOrderNo,
        orderNo,
        sku,
        productName,
        qty,
        returnType,
        subType,
        dispatchDate,
        returnCreatedDate,
        deliveredDate,
        courierPartner,
        awbNumber,
        trackingLink,
        proofOfDelivery,
        returnReason,
        detailedReturnReason,
        userEmail: activeEmail,
      });

      if (subOrderNo) subOrderNos.add(subOrderNo);
      if (orderNo) orderNos.add(orderNo);
    }

    if (validReturns.length === 0) {
      return res.status(400).json({ error: "No valid return records extracted from CSV" });
    }

    // Cross-match with existing DB orders to enrich customer name, address, state, mobile
    const existingOrders = orderNos.size > 0
      ? await ordersCol.find({
          $or: [
            { subOrderNo: { $in: Array.from(subOrderNos) } },
            { orderNo: { $in: Array.from(orderNos) } },
          ],
        }).toArray()
      : [];

    const orderMap = new Map();
    existingOrders.forEach((o) => {
      if (o.subOrderNo) orderMap.set(o.subOrderNo, o);
      if (o.orderNo) orderMap.set(o.orderNo, o);
    });

    const bulkOps = validReturns.map((item) => {
      const matchedOrder = orderMap.get(item.subOrderNo) || orderMap.get(item.orderNo) || {};

      const doc = {
        subOrderNo: item.subOrderNo,
        orderNo: item.orderNo,
        sku: item.sku || matchedOrder.sku || "",
        productName: item.productName || "",
        qty: item.qty || matchedOrder.qty || 1,
        returnType: item.returnType,
        subType: item.subType,
        dispatchDate: item.dispatchDate,
        returnCreatedDate: item.returnCreatedDate,
        deliveredDate: item.deliveredDate,
        courierPartner: item.courierPartner,
        awbNumber: item.awbNumber,
        trackingLink: item.trackingLink,
        proofOfDelivery: item.proofOfDelivery,
        returnReason: item.returnReason,
        detailedReturnReason: item.detailedReturnReason,
        // Matched Customer Info from DB
        customerName: matchedOrder.customerName || "N/A",
        customerMobile: matchedOrder.customerMobile || "N/A",
        customerAddress: matchedOrder.customerAddress || "N/A",
        state: matchedOrder.state || "India",
        district: matchedOrder.district || "Central",
        paymentType: matchedOrder.paymentType || "COD",
        originalOrderDate: matchedOrder.orderDate || "",
        userEmail: activeEmail,
        updatedAt: new Date(),
      };

      return {
        updateOne: {
          filter: { subOrderNo: item.subOrderNo, userEmail: activeEmail },
          update: { $set: doc, $setOnInsert: { createdAt: new Date() } },
          upsert: true,
        },
      };
    });

    if (bulkOps.length > 0) {
      await returnsCol.bulkWrite(bulkOps);
    }

    res.json({
      success: true,
      count: validReturns.length,
      message: `Successfully processed and saved ${validReturns.length} return entries into Database!`,
    });
  } catch (err) {
    console.error("Return Upload API Error:", err);
    res.status(500).json({ error: err.message || "Failed to parse and save return CSV" });
  }
});

// 2. GET /api/returns - Fetch return records with summary stats
app.get("/api/returns", async (req, res) => {
  try {
    const db = await getDb();
    const returnsCol = db.collection("returns");
    const activeEmail = getUserEmail(req) || "guest";

    const {
      search = "",
      type = "ALL",
      state = "ALL",
      sku = "ALL",
      page = "1",
      limit = "25",
    } = req.query;

    const pageNum = parseInt(page, 10) || 1;
    const pageSize = parseInt(limit, 10) || 25;

    const query = { userEmail: activeEmail };

    if (type && type !== "ALL") {
      query.returnType = { $regex: new RegExp(type, "i") };
    }

    if (state && state !== "ALL") {
      query.state = state;
    }

    if (sku && sku !== "ALL") {
      query.sku = sku;
    }

    if (search.trim()) {
      const q = search.trim();
      const regex = new RegExp(q, "i");
      query.$or = [
        { subOrderNo: regex },
        { orderNo: regex },
        { sku: regex },
        { customerName: regex },
        { customerMobile: regex },
        { customerAddress: regex },
        { returnReason: regex },
        { detailedReturnReason: regex },
        { courierPartner: regex },
        { awbNumber: regex },
        { state: regex },
      ];
    }

    const allReturns = await returnsCol.find({ userEmail: activeEmail }).toArray();

    const totalReturns = allReturns.length;
    let customerReturnsCount = 0;
    let rtoCount = 0;
    const skuMap = new Map();
    const reasonMap = new Map();
    const stateMap = new Map();

    allReturns.forEach((r) => {
      const isRto = /RTO|Courier/i.test(r.returnType || "");
      if (isRto) rtoCount++;
      else customerReturnsCount++;

      if (r.sku) skuMap.set(r.sku, (skuMap.get(r.sku) || 0) + 1);
      if (r.returnReason && r.returnReason !== "NA") {
        reasonMap.set(r.returnReason, (reasonMap.get(r.returnReason) || 0) + 1);
      }
      if (r.state) stateMap.set(r.state, (stateMap.get(r.state) || 0) + 1);
    });

    const allSkusWithCounts = Array.from(skuMap.entries())
      .map(([name, count]) => ({
        name,
        label: `${name} (${count})`,
        count,
      }))
      .sort((a, b) => b.count - a.count);

    const topSkuEntry = allSkusWithCounts[0];
    const topReasonEntry = Array.from(reasonMap.entries()).sort((a, b) => b[1] - a[1])[0];
    const topStateEntry = Array.from(stateMap.entries()).sort((a, b) => b[1] - a[1])[0];

    function formatSortableDate(dStr) {
      if (!dStr || typeof dStr !== "string") return "";
      const s = dStr.trim();
      if (!s) return "";
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
      const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
      if (m) {
        return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
      }
      const d = new Date(s);
      if (!isNaN(d.getTime())) return d.toISOString().substring(0, 10);
      return s;
    }

    const matchedDocs = await returnsCol.find(query).toArray();

    matchedDocs.sort((a, b) => {
      const dateA = formatSortableDate(a.deliveredDate || a.returnCreatedDate || a.dispatchDate) || "0000-00-00";
      const dateB = formatSortableDate(b.deliveredDate || b.returnCreatedDate || b.dispatchDate) || "0000-00-00";
      if (dateB !== dateA) {
        return dateB.localeCompare(dateA);
      }
      return (b._id?.toString() || "").localeCompare(a._id?.toString() || "");
    });

    const filteredTotal = matchedDocs.length;
    const startIndex = (pageNum - 1) * pageSize;
    const returnsList = matchedDocs.slice(startIndex, startIndex + pageSize);

    const formattedList = returnsList.map((r) => ({
      id: r._id.toString(),
      subOrderNo: r.subOrderNo || r.orderNo || "N/A",
      orderNo: r.orderNo || "N/A",
      sku: r.sku || "N/A",
      productName: r.productName || "",
      qty: r.qty || 1,
      returnType: r.returnType || "Return",
      subType: r.subType || "",
      dispatchDate: r.dispatchDate || "",
      returnCreatedDate: r.returnCreatedDate || "",
      deliveredDate: r.deliveredDate || "",
      courierPartner: r.courierPartner || "Courier",
      awbNumber: r.awbNumber || "N/A",
      trackingLink: r.trackingLink || "",
      proofOfDelivery: r.proofOfDelivery || "",
      returnReason: r.returnReason || "N/A",
      detailedReturnReason: r.detailedReturnReason || "",
      customerName: r.customerName || "N/A",
      customerMobile: r.customerMobile || "N/A",
      customerAddress: r.customerAddress || "N/A",
      state: r.state || "India",
      district: r.district || "Central",
      paymentType: r.paymentType || "COD",
      originalOrderDate: r.originalOrderDate || "",
      updatedAt: r.updatedAt,
    }));

    res.json({
      summary: {
        totalReturns,
        customerReturnsCount,
        rtoCount,
        topReturnedSku: topSkuEntry ? { name: topSkuEntry.name, count: topSkuEntry.count } : null,
        topReturnReason: topReasonEntry ? { name: topReasonEntry[0], count: topReasonEntry[1] } : null,
        topReturnState: topStateEntry ? { name: topStateEntry[0], count: topStateEntry[1] } : null,
        allSkusWithCounts: allSkusWithCounts || [],
      },
      pagination: {
        total: filteredTotal,
        page: pageNum,
        limit: pageSize,
        totalPages: Math.ceil(filteredTotal / pageSize) || 1,
      },
      returns: formattedList,
    });
  } catch (err) {
    console.error("Fetch Returns API Error:", err);
    res.status(500).json({ error: err.message || "Failed to fetch returns data" });
  }
});

// 3. DELETE /api/returns - Delete a return record by ID
app.delete("/api/returns", async (req, res) => {
  try {
    const db = await getDb();
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: "Return ID is required" });

    const returnsCol = db.collection("returns");
    await returnsCol.deleteOne({ _id: new ObjectId(id) });
    res.json({ success: true, message: "Return entry deleted successfully!" });
  } catch (err) {
    console.error("Delete Return API Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---- PDF ROUTES -----------------------------------------------------------

async function checkReturnHistoryForPages(fields, userEmail) {
  if (!Array.isArray(fields) || fields.length === 0) return [];
  try {
    const db = await getDb();
    const returnsCol = db.collection("returns");
    const activeEmail = userEmail || "guest";

    const allUserReturns = await returnsCol.find({ userEmail: activeEmail }).toArray();
    if (allUserReturns.length === 0) return [];

    const returnWarnings = [];

    fields.forEach((f) => {
      const fSubOrder = (f.subOrderNo || f.orderNo || "").trim();
      const fOrder = (f.orderNo || "").trim();
      const fMobile = (f.mobile || "").trim();
      const fName = (f.customerName || "").trim().toLowerCase();

      const matchedReturns = allUserReturns.filter((r) => {
        // 1. Match subOrderNo or orderNo
        if (fSubOrder && r.subOrderNo && r.subOrderNo === fSubOrder) return true;
        if (fOrder && r.orderNo && r.orderNo === fOrder) return true;

        // 2. Match Mobile Number
        if (fMobile && fMobile !== "N/A" && fMobile.length >= 10 && r.customerMobile && r.customerMobile === fMobile) return true;

        // 3. Match Customer Name + State / Address
        if (fName && fName !== "n/a" && fName.length > 3 && r.customerName) {
          const rName = r.customerName.trim().toLowerCase();
          if (rName === fName || (rName.length > 3 && (rName.includes(fName) || fName.includes(rName)))) {
            if (f.state && r.state && f.state.toLowerCase() === r.state.toLowerCase()) return true;
          }
        }
        return false;
      });

      if (matchedReturns.length > 0) {
        returnWarnings.push({
          page: f.page || 1,
          subOrderNo: fSubOrder || fOrder || "N/A",
          orderNo: fOrder || "N/A",
          customerName: f.customerName || "N/A",
          customerMobile: f.mobile || "N/A",
          customerAddress: f.address || "N/A",
          state: f.state || "India",
          sku: f.sku || "N/A",
          qty: f.qty || 1,
          returnCount: matchedReturns.length,
          previousReturns: matchedReturns.map((r) => ({
            id: r._id.toString(),
            subOrderNo: r.subOrderNo || r.orderNo || "N/A",
            returnType: r.returnType || "Return",
            returnReason: r.returnReason || "N/A",
            detailedReturnReason: r.detailedReturnReason || "",
            sku: r.sku || "N/A",
            qty: r.qty || 1,
            deliveredDate: r.deliveredDate || r.returnCreatedDate || "N/A",
            courierPartner: r.courierPartner || "Courier",
            awbNumber: r.awbNumber || "N/A",
          })),
        });
      }
    });

    return returnWarnings;
  } catch (err) {
    console.error("Error checking return history for pages:", err);
    return [];
  }
}

// 1. Upload a PDF, get back extracted per-page fields
app.post("/api/preview", upload.single("pdf"), async (req, res) => {
  req.setTimeout(600000); // 10 minutes timeout for large PDFs
  try {
    if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
      return res.status(400).json({ error: "PDF file is required and cannot be empty" });
    }
    const useNative =
      req.body?.useNativeScript === "true" ||
      req.query?.useNativeScript === "true" ||
      req.body?.useNativeScript === true;

    const startPage = parseInt(req.body?.startPage || "1", 10);
    const endPage = req.body?.endPage ? parseInt(req.body.endPage, 10) : null;

    const pageTexts = await getPerPageText(req.file.buffer, startPage, endPage);
    const fields = extractFieldsFromPages(pageTexts, useNative, startPage);

    // Auto-save extracted customer details to DB asynchronously
    saveCustomerOrders(fields, getUserEmail(req)).catch((e) => console.error("Auto-save customer error:", e));

    // Check past return history for extracted label pages
    const returnWarnings = await checkReturnHistoryForPages(fields, getUserEmail(req));

    res.json({ pageCount: fields.length, pages: fields, returnWarnings });
  } catch (err) {
    console.error("Preview API Error:", err);
    res.status(500).json({ error: err.message || "Failed to generate PDF preview" });
  }
});

// 2. Upload PDF + config, stamp QR/details, reorder pages, return processed PDF
app.post("/api/generate", upload.single("pdf"), async (req, res) => {
  req.setTimeout(600000); // 10 minutes timeout for large PDFs
  try {
    if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
      return res.status(400).json({ error: "PDF file is required and cannot be empty" });
    }

    const {
      enableQr = "true",
      useNativeScript = "false",
      qrText = "{orderNo}",
      detailText = "",
      sortBy = "none",
      sortOrder = "asc",
      qrX = "30",
      qrY = "30",
      qrSize = "90",
      fontSize = "8",
      overrides = "[]",
      sampleOnly = "false",
      startPage,
      endPage,
    } = req.body;

    const isNativeScript = String(useNativeScript) === "true";
    const isSample = String(sampleOnly) === "true";
    const shouldStampQr = String(enableQr) !== "false";

    const startP = parseInt(startPage || "1", 10);
    const endP = endPage ? parseInt(endPage, 10) : null;

    const pageTexts = await getPerPageText(req.file.buffer, startP, endP);
    let fields = extractFieldsFromPages(pageTexts, isNativeScript, startP);

    // Auto-save extracted customer details to DB asynchronously
    saveCustomerOrders(fields, getUserEmail(req)).catch((e) => console.error("Auto-save customer error:", e));

    let overrideData = [];
    try {
      overrideData = JSON.parse(overrides);
    } catch (e) {
      overrideData = [];
    }
    if (Array.isArray(overrideData) && overrideData.length > 0) {
      fields = fields.map((f, i) => {
        const pageNum = startP + i;
        const ov = overrideData.find((o) => o && o.page === pageNum) || {};
        return { ...f, ...ov };
      });
    }

    const srcDoc = await PDFDocument.load(req.file.buffer, { ignoreEncryption: true });
    const totalPdfPages = srcDoc.getPageCount();

    const rangeStartIdx = isSample ? 0 : Math.max(0, startP - 1);
    const rangeEndIdx = isSample ? 1 : (endP ? Math.min(totalPdfPages, endP) : totalPdfPages);
    const numPagesToProcess = Math.max(0, rangeEndIdx - rangeStartIdx);

    if (shouldStampQr) {
      const font = await srcDoc.embedFont(StandardFonts.TimesRomanItalic);
      const x = parseFloat(qrX) || 0;
      const y = parseFloat(qrY) || 0;
      const size = parseFloat(qrSize) || 90;
      const fSize = parseFloat(fontSize) || 8;

      const qrImageCache = new Map();
      const unicodeImageCache = new Map();

      for (let i = 0; i < numPagesToProcess; i++) {
        const pageIdx = rangeStartIdx + i;
        const page = srcDoc.getPage(pageIdx);
        const data = fields[i] || {};

        const qrContent = fillTemplate(qrText, data).trim() || `Page-${pageIdx + 1}`;
        let qrImage = qrImageCache.get(qrContent);
        if (!qrImage) {
          const qrPng = await QRCode.toBuffer(qrContent, { margin: 1, width: 300 });
          qrImage = await srcDoc.embedPng(qrPng);
          qrImageCache.set(qrContent, qrImage);
        }
        page.drawImage(qrImage, { x, y, width: size, height: size });

        const detailFilled = fillTemplate(detailText, data);
        if (detailFilled.trim()) {
          const pageWidth = page.getWidth();
          const textX = x + size + 10;
          const maxWidth = Math.max(30, pageWidth - textX - 15);
          const lines = wrapText(detailFilled, maxWidth, font, fSize);

          const lineHeight = fSize + 3;
          const totalTextHeight = (lines.length - 1) * lineHeight + fSize;
          
          const qrCenterY = y + size / 2;
          const startY = qrCenterY + totalTextHeight / 2 - fSize * 0.85;

          for (let li = 0; li < lines.length; li++) {
            const cleanLine = lines[li];
            if (cleanLine) {
              const textY = startY - li * lineHeight;
              if (textY >= 0) {
                await drawTextOrImageLine(
                  page,
                  srcDoc,
                  cleanLine,
                  textX,
                  textY,
                  fSize,
                  font,
                  rgb(0, 0, 0),
                  unicodeImageCache
                );
              }
            }
          }
        }
      }
    }

    let order = [];
    if (isSample) {
      order = [0];
    } else {
      order = fields.map((_, i) => rangeStartIdx + i);
      if (sortBy !== "none") {
        order.sort((a, b) => {
          const itemA = fields[a - rangeStartIdx] || {};
          const itemB = fields[b - rangeStartIdx] || {};

          if (sortBy === "sku") {
            const skuA = (itemA.sku || "").toString().toLowerCase();
            const skuB = (itemB.sku || "").toString().toLowerCase();
            if (skuA < skuB) return sortOrder === "asc" ? -1 : 1;
            if (skuA > skuB) return sortOrder === "asc" ? 1 : -1;
            const qtyA = parseFloat(itemA.qty) || 0;
            const qtyB = parseFloat(itemB.qty) || 0;
            return qtyB - qtyA;
          }

          let va = itemA[sortBy] ?? "";
          let vb = itemB[sortBy] ?? "";
          if (sortBy === "orderDate") {
            va = parseDdMmYyyy(va);
            vb = parseDdMmYyyy(vb);
          } else if (sortBy === "qty") {
            va = parseFloat(va) || 0;
            vb = parseFloat(vb) || 0;
          } else {
            va = va.toString().toLowerCase();
            vb = vb.toString().toLowerCase();
          }
          if (va < vb) return sortOrder === "asc" ? -1 : 1;
          if (va > vb) return sortOrder === "asc" ? 1 : -1;
          return 0;
        });
      }
    }

    const outDoc = await PDFDocument.create();
    const copiedPages = await outDoc.copyPages(srcDoc, order);
    copiedPages.forEach((p) => outDoc.addPage(p));
    const outBytes = await outDoc.save();

    const now = new Date();
    const dateStr = `${String(now.getDate()).padStart(2, "0")}.${String(now.getMonth() + 1).padStart(2, "0")}.${now.getFullYear()}`;
    const pageCount = copiedPages.length;
    const filename = isSample ? `1_${dateStr}_sample_test_page_1.pdf` : `${pageCount}_${dateStr}_stamped.pdf`;

    // Automatically Dispatch Stamped PDF (PDF format) & Summary Report (PNG Image format) to WhatsApp (918140148878)
    const skipWhatsApp = req.body?.skipWhatsApp === "true";
    if (!skipWhatsApp) {
      (async () => {
        try {
          const receiverNumber = req.body?.whatsappNumber || DEFAULT_RECEIVER_NUMBER;
          const stampedFileName = isSample ? `1_${dateStr}_sample_test_page_1.pdf` : `${pageCount}_${dateStr}_stamped.pdf`;
          const summaryFileName = isSample ? `1_${dateStr}_sample_summary.png` : `${pageCount}_${dateStr}_summary.png`;

          const sortedFields = (order || []).map((idx) => fields[idx] || {});

          // 1. Send Stamped PDF as PDF format (data:application/pdf;base64,...) with exact filename (no text caption underneath)
          const pdfBase64 = `data:application/pdf;base64,${Buffer.from(outBytes).toString("base64")}`;
          await sendWhatsAppMedia({
            number: receiverNumber,
            fileData: pdfBase64,
            fileName: stampedFileName,
            filename: stampedFileName,
            caption: "",
            mimeType: "application/pdf",
            typeName: "Stamped PDF",
          });

          // 1 second pause between media dispatches for gateway stability
          await new Promise((resolve) => setTimeout(resolve, 1000));

          // 2. Generate Summary PNG Image and Send via WhatsApp (data:image/png;base64,...) with exact filename
          const dataForSummary = sortedFields.length > 0 ? sortedFields : fields;
          if (dataForSummary && dataForSummary.length > 0) {
            const summaryPngBase64 = generateSummaryCanvasImage(dataForSummary, req.file?.originalname || "labels.pdf");
            await sendWhatsAppMedia({
              number: receiverNumber,
              fileData: summaryPngBase64,
              fileName: summaryFileName,
              filename: summaryFileName,
              caption: "",
              mimeType: "image/png",
              typeName: "Summary PNG Image",
            });
          }
        } catch (waErr) {
          console.error("[WhatsApp Integration Error]:", waErr.message);
        }
      })();
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(Buffer.from(outBytes));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint to dispatch final merged PDF & final summary PNG image to WhatsApp
app.post("/api/whatsapp/dispatch-final", upload.single("pdf"), async (req, res) => {
  req.setTimeout(600000);
  try {
    const receiverNumber = req.body?.whatsappNumber || DEFAULT_RECEIVER_NUMBER;
    const fileName = req.body?.fileName || "labels.pdf";
    let pages = [];
    try {
      pages = JSON.parse(req.body?.pages || "[]");
    } catch (e) {
      pages = [];
    }

    const totalPages = pages.length || 1;
    const now = new Date();
    const dateStr = `${String(now.getDate()).padStart(2, "0")}.${String(now.getMonth() + 1).padStart(2, "0")}.${now.getFullYear()}`;
    const stampedFileName = `${totalPages}_${dateStr}_stamped.pdf`;
    const summaryFileName = `${totalPages}_${dateStr}_summary.png`;

    if (req.file && req.file.buffer && req.file.buffer.length > 0) {
      const pdfBase64 = `data:application/pdf;base64,${req.file.buffer.toString("base64")}`;
      await sendWhatsAppMedia({
        number: receiverNumber,
        fileData: pdfBase64,
        fileName: stampedFileName,
        filename: stampedFileName,
        caption: "",
        mimeType: "application/pdf",
        typeName: "Stamped PDF",
      });
    }

    if (pages && pages.length > 0) {
      await new Promise((r) => setTimeout(r, 1000));
      const summaryPngBase64 = generateSummaryCanvasImage(pages, fileName);
      await sendWhatsAppMedia({
        number: receiverNumber,
        fileData: summaryPngBase64,
        fileName: summaryFileName,
        filename: summaryFileName,
        caption: "",
        mimeType: "image/png",
        typeName: "Summary PNG Image",
      });
    }

    res.json({ success: true, message: "Final PDF & Summary dispatched to WhatsApp successfully!" });
  } catch (err) {
    console.error("WhatsApp Final Dispatch Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Helper function to generate PDF Summary report
async function generateSummaryPdf(pagesData, sourceFileName = "labels.pdf") {
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const skuMap = {};
  const multiQtyOrders = [];
  let totalQtySum = 0;

  pagesData.forEach((item, index) => {
    const sku = (item.sku || "UNSPECIFIED_SKU").trim();
    const qtyVal = parseInt(item.qty, 10) || 1;
    totalQtySum += qtyVal;

    if (!skuMap[sku]) {
      skuMap[sku] = {
        sku,
        totalOrders: 0,
        totalQty: 0,
        multiQtyCount: 0,
        orders: [],
      };
    }

    skuMap[sku].totalOrders += 1;
    skuMap[sku].totalQty += qtyVal;
    if (qtyVal > 1) {
      skuMap[sku].multiQtyCount += 1;
      multiQtyOrders.push({
        page: item.page || index + 1,
        orderNo: item.orderNo || "N/A",
        sku,
        qty: qtyVal,
        customerName: item.customerName || "N/A",
      });
    }
    skuMap[sku].orders.push(item);
  });

  const skuList = Object.values(skuMap).sort((a, b) => b.totalQty - a.totalQty);
  const totalLabels = pagesData.length;
  const totalSkus = skuList.length;
  const totalMultiQty = multiQtyOrders.length;

  let page = pdfDoc.addPage([595.28, 841.89]);
  let { width, height } = page.getSize();
  let y = height - 40;

  function checkPageSpace(requiredHeight) {
    if (y - requiredHeight < 50) {
      page = pdfDoc.addPage([595.28, 841.89]);
      y = height - 50;
      page.drawText("ORDER & SKU SUMMARY REPORT (Continued)", {
        x: 40,
        y: y,
        size: 9,
        font: fontBold,
        color: rgb(0.4, 0.4, 0.4),
      });
      y -= 25;
    }
  }

  // Header Banner
  page.drawRectangle({
    x: 0,
    y: height - 70,
    width,
    height: 70,
    color: rgb(0.06, 0.09, 0.16),
  });

  page.drawText("ORDER & SKU BATCH SUMMARY", {
    x: 40,
    y: height - 38,
    size: 18,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  const cleanFileName = sourceFileName.replace(/\.pdf$/i, "");
  page.drawText(`File: ${cleanFileName}.pdf  |  Generated: ${new Date().toLocaleString("en-IN")}`, {
    x: 40,
    y: height - 56,
    size: 8.5,
    font: fontRegular,
    color: rgb(0.7, 0.8, 0.95),
  });

  y = height - 95;

  // Stats Box Cards
  const cardW = 120;
  const cardH = 44;
  const gap = 11;
  const stats = [
    { label: "TOTAL LABELS", val: String(totalLabels), color: rgb(0.1, 0.45, 0.9) },
    { label: "TOTAL ITEM QTY", val: String(totalQtySum), color: rgb(0.05, 0.65, 0.4) },
    { label: "UNIQUE SKUs", val: String(totalSkus), color: rgb(0.5, 0.2, 0.8) },
    { label: "MULTI-QTY (>1)", val: String(totalMultiQty), color: totalMultiQty > 0 ? rgb(0.85, 0.2, 0.2) : rgb(0.4, 0.4, 0.4) },
  ];

  stats.forEach((s, idx) => {
    const cardX = 40 + idx * (cardW + gap);
    page.drawRectangle({
      x: cardX,
      y: y - cardH,
      width: cardW,
      height: cardH,
      color: rgb(0.96, 0.97, 0.98),
      borderColor: s.color,
      borderWidth: 1.5,
    });
    page.drawText(s.label, {
      x: cardX + 8,
      y: y - 14,
      size: 7,
      font: fontBold,
      color: rgb(0.3, 0.3, 0.3),
    });
    page.drawText(s.val, {
      x: cardX + 8,
      y: y - 36,
      size: 16,
      font: fontBold,
      color: s.color,
    });
  });

  y -= (cardH + 25);

  // Table 1: SKU Breakdown
  checkPageSpace(60);
  page.drawText("1. SKU ORDER BREAKDOWN", {
    x: 40,
    y,
    size: 11,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.1),
  });
  y -= 16;

  const colX = [40, 75, 320, 405, 480];
  page.drawRectangle({
    x: 40,
    y: y - 18,
    width: 515,
    height: 20,
    color: rgb(0.15, 0.23, 0.37),
  });

  const headers = ["S.No", "SKU Name / Description", "Total Orders", "Total Qty", "Multi-Qty (>1)"];
  headers.forEach((h, i) => {
    page.drawText(h, {
      x: colX[i] + 4,
      y: y - 13,
      size: 8,
      font: fontBold,
      color: rgb(1, 1, 1),
    });
  });

  y -= 20;

  skuList.forEach((item, idx) => {
    checkPageSpace(20);
    const isEven = idx % 2 === 0;
    page.drawRectangle({
      x: 40,
      y: y - 16,
      width: 515,
      height: 18,
      color: isEven ? rgb(1, 1, 1) : rgb(0.97, 0.98, 0.99),
      borderColor: rgb(0.9, 0.9, 0.9),
      borderWidth: 0.5,
    });

    page.drawText(String(idx + 1), { x: colX[0] + 4, y: y - 12, size: 8, font: fontRegular });
    
    let skuText = item.sku;
    if (skuText.length > 42) skuText = skuText.substring(0, 39) + "...";
    page.drawText(skuText, { x: colX[1] + 4, y: y - 12, size: 8, font: fontBold, color: rgb(0.1, 0.1, 0.1) });

    page.drawText(String(item.totalOrders), { x: colX[2] + 4, y: y - 12, size: 8, font: fontRegular });
    page.drawText(String(item.totalQty), { x: colX[3] + 4, y: y - 12, size: 8, font: fontBold, color: rgb(0.05, 0.6, 0.35) });
    
    const multiText = item.multiQtyCount > 0 ? `${item.multiQtyCount} Orders` : "0";
    const multiColor = item.multiQtyCount > 0 ? rgb(0.85, 0.15, 0.15) : rgb(0.5, 0.5, 0.5);
    page.drawText(multiText, { x: colX[4] + 4, y: y - 12, size: 8, font: item.multiQtyCount > 0 ? fontBold : fontRegular, color: multiColor });

    y -= 18;
  });

  // Table 1 Total Row
  checkPageSpace(22);
  page.drawRectangle({
    x: 40,
    y: y - 18,
    width: 515,
    height: 20,
    color: rgb(0.92, 0.95, 0.98),
    borderColor: rgb(0.7, 0.8, 0.9),
    borderWidth: 1,
  });
  page.drawText("TOTAL BATCH SUMMARY", { x: colX[1] + 4, y: y - 13, size: 8.5, font: fontBold, color: rgb(0.1, 0.2, 0.4) });
  page.drawText(String(totalLabels), { x: colX[2] + 4, y: y - 13, size: 8.5, font: fontBold, color: rgb(0.1, 0.2, 0.4) });
  page.drawText(String(totalQtySum), { x: colX[3] + 4, y: y - 13, size: 8.5, font: fontBold, color: rgb(0.05, 0.6, 0.35) });
  page.drawText(String(totalMultiQty), { x: colX[4] + 4, y: y - 13, size: 8.5, font: fontBold, color: totalMultiQty > 0 ? rgb(0.85, 0.15, 0.15) : rgb(0.3, 0.3, 0.3) });

  y -= 35;

  // Table 2: Multi-Quantity Orders Section (Highlighted Box)
  checkPageSpace(60);

  if (multiQtyOrders.length > 0) {
    page.drawRectangle({
      x: 40,
      y: y - 22,
      width: 515,
      height: 24,
      color: rgb(0.98, 0.9, 0.9),
      borderColor: rgb(0.85, 0.2, 0.2),
      borderWidth: 1.5,
    });

    page.drawText("MULTI-QUANTITY ORDERS (QTY > 1) - HIGHLIGHTED PACKING ALERT", {
      x: 48,
      y: y - 15,
      size: 9,
      font: fontBold,
      color: rgb(0.75, 0.1, 0.1),
    });

    y -= 26;

    const mColX = [40, 85, 230, 410, 470];
    page.drawRectangle({
      x: 40,
      y: y - 18,
      width: 515,
      height: 20,
      color: rgb(0.8, 0.15, 0.15),
    });

    const mHeaders = ["Page #", "Order Number", "SKU Name", "QUANTITY", "Customer Name"];
    mHeaders.forEach((h, i) => {
      page.drawText(h, {
        x: mColX[i] + 4,
        y: y - 13,
        size: 8,
        font: fontBold,
        color: rgb(1, 1, 1),
      });
    });

    y -= 20;

    multiQtyOrders.forEach((mOrder, idx) => {
      checkPageSpace(20);
      
      page.drawRectangle({
        x: 40,
        y: y - 18,
        width: 515,
        height: 20,
        color: idx % 2 === 0 ? rgb(1, 0.94, 0.94) : rgb(0.98, 0.9, 0.9),
        borderColor: rgb(0.9, 0.6, 0.6),
        borderWidth: 0.5,
      });

      page.drawText(`Page ${mOrder.page}`, { x: mColX[0] + 4, y: y - 13, size: 8, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
      page.drawText(String(mOrder.orderNo), { x: mColX[1] + 4, y: y - 13, size: 8, font: fontRegular, color: rgb(0.1, 0.1, 0.1) });
      
      let skuText = mOrder.sku;
      if (skuText.length > 28) skuText = skuText.substring(0, 25) + "...";
      page.drawText(skuText, { x: mColX[2] + 4, y: y - 13, size: 8, font: fontBold, color: rgb(0.1, 0.1, 0.1) });

      // Highlighted QTY Badge
      page.drawRectangle({
        x: mColX[3] + 2,
        y: y - 16,
        width: 48,
        height: 15,
        color: rgb(0.85, 0.15, 0.15),
      });
      page.drawText(`QTY: ${mOrder.qty}`, { x: mColX[3] + 6, y: y - 12, size: 8.5, font: fontBold, color: rgb(1, 1, 1) });

      let custText = mOrder.customerName;
      if (custText.length > 16) custText = custText.substring(0, 13) + "...";
      page.drawText(custText, { x: mColX[4] + 4, y: y - 13, size: 8, font: fontRegular, color: rgb(0.2, 0.2, 0.2) });

      y -= 20;
    });
  } else {
    page.drawRectangle({
      x: 40,
      y: y - 24,
      width: 515,
      height: 26,
      color: rgb(0.9, 0.98, 0.94),
      borderColor: rgb(0.1, 0.65, 0.35),
      borderWidth: 1,
    });
    page.drawText("ALL ORDERS ARE SINGLE QUANTITY (QTY = 1) - No multi-quantity packing alerts.", {
      x: 52,
      y: y - 16,
      size: 8.5,
      font: fontBold,
      color: rgb(0.05, 0.5, 0.25),
    });
    y -= 30;
  }

  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}

// Summary PDF Endpoint
app.post("/api/generate-summary", async (req, res) => {
  try {
    const { pages = [], fileName = "labels.pdf" } = req.body;
    if (!Array.isArray(pages) || pages.length === 0) {
      return res.status(400).json({ error: "No page data available to generate summary" });
    }

    const pdfBuffer = await generateSummaryPdf(pages, fileName);
    const now = new Date();
    const dateStr = `${String(now.getDate()).padStart(2, "0")}.${String(now.getMonth() + 1).padStart(2, "0")}.${now.getFullYear()}`;
    const pageCount = pages.length;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${pageCount}_${dateStr}_summary.pdf"`);
    res.send(Buffer.from(pdfBuffer));
  } catch (err) {
    console.error("Summary generation error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Explicit WhatsApp Media Dispatch Endpoint (Secured)
app.post("/api/whatsapp/send-media", async (req, res) => {
  try {
    const email = getUserEmail(req);
    const internalSecret = req.headers["x-internal-secret"];
    if (!email && internalSecret !== "core-engine-internal") {
      return res.status(401).json({ error: "Unauthorized / Authentication required to access WhatsApp API" });
    }

    const { number = DEFAULT_RECEIVER_NUMBER, fileData, typeName = "Media", fileName, caption, mimeType } = req.body;
    if (!fileData) {
      return res.status(400).json({ error: "Missing fileData parameter" });
    }
    const result = await sendWhatsAppMedia({
      number,
      fileData,
      fileName,
      caption,
      mimeType,
      typeName,
    });
    res.json({ success: true, result });
  } catch (err) {
    console.error("[WhatsApp Endpoint Error]:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---- DATABASE & API ROUTES ------------------------------------------------

// 3. User Settings
app.get("/api/user/settings", async (req, res) => {
  try {
    const email = getUserEmail(req);
    if (!email) return res.status(401).json({ error: "Unauthorized / Missing user email" });

    const db = await getDb();
    const settings = await db.collection("user_settings").findOne({ email });
    res.json({ settings: settings || null });
  } catch (err) {
    console.error("Error fetching settings:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/user/settings", async (req, res) => {
  try {
    const email = getUserEmail(req);
    if (!email) return res.status(401).json({ error: "Unauthorized / Missing user email" });

    const {
      storeName,
      phone,
      supportEmail,
      storeUrl,
      instagramHandle,
      customNote,
      enableQr,
      qrText,
      detailText,
      qrX,
      qrY,
      qrSize,
      fontSize,
      sortBy,
      sortOrder,
      downloadSummary,
    } = req.body;

    const db = await getDb();
    await db.collection("user_settings").updateOne(
      { email },
      {
        $set: {
          email,
          storeName: storeName !== undefined ? storeName : "",
          phone: phone !== undefined ? phone : "",
          supportEmail: supportEmail !== undefined ? supportEmail : "",
          storeUrl: storeUrl !== undefined ? storeUrl : "",
          instagramHandle: instagramHandle !== undefined ? instagramHandle : "",
          customNote: customNote !== undefined ? customNote : "",
          enableQr: enableQr !== undefined ? enableQr : true,
          qrText: qrText !== undefined ? qrText : "https://www.meesho.com/themahirenterprise",
          detailText: detailText !== undefined ? detailText : "Scan to Follow Meesho Store!\nOrder: {orderNo}\nSKU: {sku}",
          qrX: qrX !== undefined ? qrX : 30,
          qrY: qrY !== undefined ? qrY : 30,
          qrSize: qrSize !== undefined ? qrSize : 90,
          fontSize: fontSize !== undefined ? fontSize : 8,
          sortBy: sortBy !== undefined ? sortBy : "sku",
          sortOrder: sortOrder !== undefined ? sortOrder : "asc",
          downloadSummary: downloadSummary !== undefined ? downloadSummary : false,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Error saving settings:", err);
    res.status(500).json({ error: err.message });
  }
});

// 4. Templates
app.get("/api/templates", async (req, res) => {
  try {
    const email = getUserEmail(req);
    if (!email) return res.status(401).json({ error: "Unauthorized / Missing user email" });

    const db = await getDb();
    let templates = await db
      .collection("templates")
      .find({ email })
      .sort({ createdAt: -1 })
      .toArray();

    if (templates.length === 0) {
      const seeded = DEFAULT_TEMPLATES.map((t) => ({
        ...t,
        email,
        createdAt: new Date(),
      }));
      await db.collection("templates").insertMany(seeded);
      templates = await db
        .collection("templates")
        .find({ email })
        .sort({ createdAt: -1 })
        .toArray();
    }

    res.json({ templates });
  } catch (err) {
    console.error("Error fetching templates:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/templates", async (req, res) => {
  try {
    const email = getUserEmail(req);
    if (!email) return res.status(401).json({ error: "Unauthorized / Missing user email" });

    const {
      name,
      description,
      enableQr,
      qrText,
      detailText,
      qrX,
      qrY,
      qrSize,
      fontSize,
      sortBy,
      sortOrder,
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Template name is required" });
    }

    const db = await getDb();
    const result = await db.collection("templates").insertOne({
      email,
      name: name.trim(),
      description: description || "",
      enableQr: Boolean(enableQr),
      qrText: qrText || "https://www.meesho.com/themahirenterprise",
      detailText: detailText || "",
      qrX: parseFloat(qrX) || 30,
      qrY: parseFloat(qrY) || 30,
      qrSize: parseFloat(qrSize) || 90,
      fontSize: parseFloat(fontSize) || 8,
      sortBy: sortBy || "sku",
      sortOrder: sortOrder || "asc",
      createdAt: new Date(),
    });

    res.json({ success: true, id: result.insertedId });
  } catch (err) {
    console.error("Error creating template:", err);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/templates", async (req, res) => {
  try {
    const email = getUserEmail(req);
    if (!email) return res.status(401).json({ error: "Unauthorized / Missing user email" });

    const id = req.query.id;
    if (!id) return res.status(400).json({ error: "Template ID is required" });

    const db = await getDb();
    await db.collection("templates").deleteOne({
      _id: new ObjectId(id),
      email,
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Error deleting template:", err);
    res.status(500).json({ error: err.message });
  }
});

// 5. History
app.get("/api/history", async (req, res) => {
  try {
    const email = getUserEmail(req);
    if (!email) return res.status(401).json({ error: "Unauthorized / Missing user email" });

    const db = await getDb();
    const history = await db
      .collection("batch_history")
      .find({ email })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();

    res.json({ history });
  } catch (err) {
    console.error("Error fetching history:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/history", async (req, res) => {
  try {
    const email = getUserEmail(req);
    if (!email) return res.status(401).json({ error: "Unauthorized / Missing user email" });

    const { fileName, pageCount, isSample, sortBy, sortOrder, enableQr, qrText } = req.body;

    const db = await getDb();
    await db.collection("batch_history").insertOne({
      email,
      fileName: fileName || "Untitled_Batch.pdf",
      pageCount: pageCount || 1,
      isSample: Boolean(isSample),
      sortBy: sortBy || "sku",
      sortOrder: sortOrder || "asc",
      enableQr: Boolean(enableQr),
      qrText: qrText || "",
      createdAt: new Date(),
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Error creating history log:", err);
    res.status(500).json({ error: err.message });
  }
});

// 6. Analytics
app.get("/api/analytics", async (req, res) => {
  try {
    const email = getUserEmail(req);
    if (!email) return res.status(401).json({ error: "Unauthorized / Missing user email" });

    const db = await getDb();
    const scans = await db
      .collection("qr_scans")
      .find({ sellerEmail: email })
      .sort({ createdAt: -1 })
      .toArray();

    const totalScans = scans.length;
    const uniqueOrders = new Set(scans.map((s) => s.orderNo).filter(Boolean)).size;

    const todayStr = new Date().toISOString().split("T")[0];
    const todayScans = scans.filter((s) => s.date === todayStr).length;

    const dailyMap = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split("T")[0];
      const dayName = d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
      dailyMap[key] = { date: key, label: dayName, count: 0 };
    }

    scans.forEach((s) => {
      if (dailyMap[s.date]) {
        dailyMap[s.date].count += 1;
      }
    });

    const dailyTimeline = Object.values(dailyMap);

    const skuCountMap = {};
    scans.forEach((s) => {
      const sku = s.sku || "General / Unknown";
      skuCountMap[sku] = (skuCountMap[sku] || 0) + 1;
    });

    const topSkus = Object.entries(skuCountMap)
      .map(([sku, count]) => ({
        sku,
        count,
        percent: totalScans > 0 ? Math.round((count / totalScans) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    let meeshoCount = 0;
    let instagramCount = 0;
    let otherCount = 0;

    scans.forEach((s) => {
      const url = (s.targetUrl || "").toLowerCase();
      if (url.includes("meesho")) meeshoCount++;
      else if (url.includes("instagram")) instagramCount++;
      else otherCount++;
    });

    const destinations = [
      { name: "Meesho Store", count: meeshoCount, percent: totalScans > 0 ? Math.round((meeshoCount / totalScans) * 100) : 0 },
      { name: "Instagram Profile", count: instagramCount, percent: totalScans > 0 ? Math.round((instagramCount / totalScans) * 100) : 0 },
      { name: "Direct / Other Link", count: otherCount, percent: totalScans > 0 ? Math.round((otherCount / totalScans) * 100) : 0 },
    ];

    const recentScans = scans.slice(0, 20).map((s) => ({
      id: s._id,
      orderNo: s.orderNo || "N/A",
      sku: s.sku || "General",
      targetUrl: s.targetUrl,
      isMobile: s.isMobile !== false,
      createdAt: s.createdAt,
      date: s.date,
    }));

    res.json({
      totalScans,
      uniqueOrders,
      todayScans,
      dailyTimeline,
      topSkus,
      destinations,
      recentScans,
    });
  } catch (err) {
    console.error("Analytics Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST to simulate/record test scan
app.post("/api/analytics", async (req, res) => {
  try {
    const email = getUserEmail(req);
    if (!email) return res.status(401).json({ error: "Unauthorized / Missing user email" });

    const { orderNo, sku, targetUrl } = req.body;
    const db = await getDb();
    const now = new Date();

    await db.collection("qr_scans").insertOne({
      sellerEmail: email,
      orderNo: orderNo || "OD-398241029_1",
      sku: sku || "SAMPLE-SKU-COTTON-SHIRT",
      targetUrl: targetUrl || "https://www.meesho.com/themahirenterprise",
      isMobile: true,
      userAgent: req.headers["user-agent"] || "Test Agent",
      createdAt: now,
      date: now.toISOString().split("T")[0],
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Failed to log scan:", err);
    res.status(500).json({ error: err.message });
  }
});

// 7. Fast Short URL Redirect & Analytics Tracker
app.get("/r/:code", async (req, res) => {
  try {
    const code = req.params.code;
    if (!code) {
      return res.redirect(process.env.FRONTEND_URL || "http://localhost:3000");
    }

    const db = await getDb();
    let track = await db.collection("qr_tracks").findOne({ code });

    let targetUrl = "https://www.meesho.com/themahirenterprise";
    let sellerEmail = "vishal.nexios@gmail.com";
    let orderNo = "DIRECT_SCAN";
    let sku = "GENERAL";

    if (track) {
      targetUrl = track.targetUrl || targetUrl;
      sellerEmail = track.sellerEmail || sellerEmail;
      orderNo = track.orderNo || orderNo;
      sku = track.sku || sku;
    } else {
      try {
        const decoded = Buffer.from(code, "base64").toString("utf-8");
        if (decoded.startsWith("http")) {
          targetUrl = decoded;
        } else {
          const parsed = JSON.parse(decoded);
          if (parsed.u) targetUrl = parsed.u;
          if (parsed.e) sellerEmail = parsed.e;
          if (parsed.o) orderNo = parsed.o;
          if (parsed.s) sku = parsed.s;
        }
      } catch (e) {
        // fallback
      }
    }

    const now = new Date();
    const dateStr = now.toISOString().split("T")[0];
    const userAgent = req.headers["user-agent"] || "";
    const isMobile = /mobile|android|iphone|ipad|ipod/i.test(userAgent);

    await db.collection("qr_scans").insertOne({
      code,
      sellerEmail,
      orderNo,
      sku,
      targetUrl,
      isMobile,
      userAgent: userAgent.substring(0, 150),
      createdAt: now,
      date: dateStr,
    });

    if (track) {
      await db.collection("qr_tracks").updateOne(
        { code },
        { $inc: { scanCount: 1 }, $set: { lastScannedAt: now } }
      );
    }

    if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
      targetUrl = `https://${targetUrl}`;
    }

    res.redirect(302, targetUrl);
  } catch (err) {
    console.error("QR Redirect Error:", err);
    res.redirect(302, "https://www.meesho.com");
  }
});

const PORT = process.env.PORT || 5001;
const server = app.listen(PORT, () => console.log(`🚀 LABCOM Backend running on http://localhost:${PORT}`));
server.timeout = 10 * 60 * 1000; // 10 minutes timeout
server.keepAliveTimeout = 10 * 60 * 1000;
server.headersTimeout = 10 * 60 * 1000 + 1000;
