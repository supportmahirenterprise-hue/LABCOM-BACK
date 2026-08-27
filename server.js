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

const app = express();
app.use(cors());
app.use(express.json());

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
  res.json({ status: "ok", message: "LABCOM Backend is live and healthy!" });
});

app.get("/api/health", (req, res) => res.json({ ok: true }));

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
  return str.replace(/[^\x00-\x7F\u00A0-\u00FF]/g, "").trim();
}

function wrapText(text, maxWidth, font, fontSize) {
  if (!text) return [];
  const rawLines = text.split("\n");
  const wrappedLines = [];

  for (const rawLine of rawLines) {
    const clean = cleanWinAnsi(rawLine);
    if (!clean) {
      wrappedLines.push("");
      continue;
    }

    if (maxWidth <= 0 || font.widthOfTextAtSize(clean, fontSize) <= maxWidth) {
      wrappedLines.push(clean);
      continue;
    }

    const words = clean.split(/\s+/);
    let currentLine = "";

    for (const word of words) {
      if (!word) continue;
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const testWidth = font.widthOfTextAtSize(testLine, fontSize);

      if (testWidth <= maxWidth) {
        currentLine = testLine;
      } else {
        if (currentLine) {
          wrappedLines.push(currentLine);
          currentLine = word;
        } else {
          // If a single word exceeds maxWidth, break character by character
          let piece = "";
          for (const char of word) {
            if (font.widthOfTextAtSize(piece + char, fontSize) <= maxWidth) {
              piece += char;
            } else {
              if (piece) wrappedLines.push(piece);
              piece = char;
            }
          }
          currentLine = piece;
        }
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
    const pageTexts = await getPerPageText(req.file.buffer);
    const fields = extractFieldsFromPages(pageTexts);
    res.json({ pageCount: fields.length, pages: fields });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 2. Upload PDF + config, stamp QR/details, reorder pages, return processed PDF
app.post("/api/generate", upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "PDF file is required" });

    const {
      enableQr = "true",
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

    const isSample = String(sampleOnly) === "true";
    const shouldStampQr = String(enableQr) !== "false";

    const pageTexts = await getPerPageText(req.file.buffer);
    let fields = extractFieldsFromPages(pageTexts);

    let overrideData = [];
    try {
      overrideData = JSON.parse(overrides);
    } catch (e) {
      overrideData = [];
    }
    if (Array.isArray(overrideData) && overrideData.length === fields.length) {
      fields = fields.map((f, i) => ({ ...f, ...overrideData[i] }));
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

      for (let i = 0; i < totalPagesToProcess; i++) {
        const page = pages[i];
        const data = fields[i] || {};

        const qrContent = fillTemplate(qrText, data).trim() || `Page-${i + 1}`;
        const qrPng = await QRCode.toBuffer(qrContent, { margin: 1, width: 300 });
        const qrImage = await srcDoc.embedPng(qrPng);
        page.drawImage(qrImage, { x, y, width: size, height: size });

        const detailFilled = fillTemplate(detailText, data);
        if (detailFilled.trim()) {
          const pageWidth = page.getWidth();
          const textX = x + size + 10;
          const maxWidth = Math.max(40, pageWidth - textX - 10);
          const lines = wrapText(detailFilled, maxWidth, font, fSize);

          lines.forEach((cleanLine, li) => {
            if (cleanLine) {
              const textY = y + size - 12 - li * (fSize + 3);
              if (textY >= 0) {
                page.drawText(cleanLine, {
                  x: textX,
                  y: textY,
                  size: fSize,
                  font,
                  color: rgb(0, 0, 0),
                });
              }
            }
          });
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
