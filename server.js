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

const path = require("path");
const fs = require("fs");
const { Resvg } = require("@resvg/resvg-js");

let indianFontBuffers = [];
const localFontPath = path.join(__dirname, "fonts", "Nirmala.ttf");
if (fs.existsSync(localFontPath)) {
  indianFontBuffers.push(fs.readFileSync(localFontPath));
} else if (fs.existsSync("C:\\Windows\\Fonts\\Nirmala.ttf")) {
  indianFontBuffers.push(fs.readFileSync("C:\\Windows\\Fonts\\Nirmala.ttf"));
}

const app = express();
app.use(cors());
app.use(express.json());

async function drawTextOrImageLine(page, srcDoc, text, x, y, size, font, color, imageCache = null) {
  const isUnicode = /[^\x00-\x7F]/.test(text);

  if (isUnicode) {
    try {
      const cacheKey = `${text}_${size}`;
      let cached = imageCache ? imageCache.get(cacheKey) : null;

      if (!cached) {
        const textEscaped = text
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");

        const fontSizePx = Math.round(size * 3.2);
        const svgHeightPx = Math.round(fontSizePx * 1.6);
        const svgWidthPx = Math.max(300, Math.round(text.length * fontSizePx * 1.1));

        const svg = `<svg width="${svgWidthPx}" height="${svgHeightPx}" xmlns="http://www.w3.org/2000/svg">
          <style>
            .txt {
              font-family: 'Nirmala UI', 'Noto Sans', 'Segoe UI', sans-serif;
              font-size: ${fontSizePx}px;
              font-weight: bold;
              fill: #000000;
            }
          </style>
          <text x="0" y="${fontSizePx}" class="txt">${textEscaped}</text>
        </svg>`;

        const resvg = new Resvg(svg, {
          fitTo: { mode: 'height', value: svgHeightPx },
          font: {
            loadSystemFonts: false,
            fontBuffers: indianFontBuffers,
            defaultFontFamily: 'Nirmala UI',
          },
        });
        const pngBuffer = resvg.render().asPng();
        const pngImg = await srcDoc.embedPng(pngBuffer);

        const renderHeight = size * 1.2;
        const renderWidth = (svgWidthPx / svgHeightPx) * renderHeight;

        cached = { pngImg, renderWidth, renderHeight };
        if (imageCache) {
          imageCache.set(cacheKey, cached);
        }
      }

      page.drawImage(cached.pngImg, {
        x: x,
        y: y - 1,
        width: cached.renderWidth,
        height: cached.renderHeight,
      });
      return;
    } catch (e) {
      console.error("Native SVG render error:", e);
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
  return (
    req.headers["x-user-email"] ||
    req.query.email ||
    (req.body && req.body.email) ||
    ""
  ).toLowerCase().trim();
}

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    version: "1.0.1-font-cache-fix",
    fontLoaded: indianFontBuffers.length > 0,
    message: "LABCOM Backend is live and healthy!",
  });
});

app.get("/api/health", (req, res) =>
  res.json({
    ok: true,
    version: "1.0.1-font-cache-fix",
    fontLoaded: indianFontBuffers.length > 0,
  })
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 }, // 30 MB
});

// ---- helpers -------------------------------------------------------------

async function getPerPageText(buffer) {
  const pageTexts = [];
  await pdfParse(buffer, {
    pagerender: async (pageData) => {
      const textContent = await pageData.getTextContent();
      const text = textContent.items.map((i) => i.str).join("\n");
      pageTexts.push(text);
      return text;
    },
  });
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
        for (const char of word) {
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

// ---- PDF ROUTES -----------------------------------------------------------

// 1. Upload a PDF, get back extracted per-page fields
app.post("/api/preview", upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "PDF file is required" });
    const useNative =
      req.body?.useNativeScript === "true" ||
      req.query?.useNativeScript === "true" ||
      req.body?.useNativeScript === true;
    const pageTexts = await getPerPageText(req.file.buffer);
    const fields = extractFieldsFromPages(pageTexts, useNative);
    res.json({ pageCount: fields.length, pages: fields });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 2. Upload PDF + config, stamp QR/details, reorder pages, return processed PDF
app.post("/api/generate", upload.single("pdf"), async (req, res) => {
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
    } = req.body;

    const isNativeScript = String(useNativeScript) === "true";
    const isSample = String(sampleOnly) === "true";
    const shouldStampQr = String(enableQr) !== "false";

    const pageTexts = await getPerPageText(req.file.buffer);
    let fields = extractFieldsFromPages(pageTexts, isNativeScript);

    let overrideData = [];
    try {
      overrideData = JSON.parse(overrides);
    } catch (e) {
      overrideData = [];
    }
    if (Array.isArray(overrideData) && overrideData.length > 0) {
      fields = fields.map((f, i) => {
        const ov = overrideData[i] || overrideData.find((o) => o && o.page === i + 1) || {};
        return { ...f, ...ov };
      });
    }

    const srcDoc = await PDFDocument.load(req.file.buffer);
    const pages = srcDoc.getPages();
    const totalPagesToProcess = isSample ? Math.min(1, pages.length) : pages.length;

    if (shouldStampQr) {
      const font = await srcDoc.embedFont(StandardFonts.TimesRomanItalic);
      const x = parseFloat(qrX) || 0;
      const y = parseFloat(qrY) || 0;
      const size = parseFloat(qrSize) || 90;
      const fSize = parseFloat(fontSize) || 8;

      const qrImageCache = new Map();
      const unicodeImageCache = new Map();

      for (let i = 0; i < totalPagesToProcess; i++) {
        const page = pages[i];
        const data = fields[i] || {};

        const qrContent = fillTemplate(qrText, data).trim() || `Page-${i + 1}`;
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
          
          // Vertically center the text block with respect to the QR code height
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
      order = fields.map((_, i) => i);
      if (sortBy !== "none") {
        order.sort((a, b) => {
          const itemA = fields[a];
          const itemB = fields[b];

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

    const filename = isSample ? "sample_test_page_1.pdf" : "labels_processed.pdf";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(Buffer.from(outBytes));
  } catch (err) {
    console.error(err);
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
    const baseName = fileName.replace(/\.pdf$/i, "");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${baseName}_summary.pdf"`);
    res.send(Buffer.from(pdfBuffer));
  } catch (err) {
    console.error("Summary generation error:", err);
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
app.listen(PORT, () => console.log(`🚀 LABCOM Backend running on http://localhost:${PORT}`));
