const express = require("express");
const multer = require("multer");
const cors = require("cors");
const pdfParse = require("pdf-parse");
const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const QRCode = require("qrcode");
const { extractFieldsFromPages } = require("./utils/extractFields");

const app = express();
app.use(cors());
app.use(express.json());

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

// ---- routes ---------------------------------------------------------------

app.get("/api/health", (req, res) => res.json({ ok: true }));

// Upload a PDF, get back extracted per-page fields (for preview/editing table)
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

// Upload a PDF + config, get back the final processed PDF (QR+details stamped,
// pages reordered per sortBy/sortOrder).
app.post("/api/generate", upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "PDF file is required" });

    const {
      qrText = "{orderNo}",
      detailText = "",
      sortBy = "none",
      sortOrder = "asc",
      qrX = "30",
      qrY = "30",
      qrSize = "90",
      fontSize = "8",
      overrides = "[]",
    } = req.body;

    const pageTexts = await getPerPageText(req.file.buffer);
    let fields = extractFieldsFromPages(pageTexts);

    // Apply any manual corrections the user made in the preview table
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
    const font = await srcDoc.embedFont(StandardFonts.TimesRomanItalic);

    const x = parseFloat(qrX) || 0;
    const y = parseFloat(qrY) || 0;
    const size = parseFloat(qrSize) || 90;
    const fSize = parseFloat(fontSize) || 8;

    const pages = srcDoc.getPages();
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const data = fields[i] || {};

      const qrContent = fillTemplate(qrText, data).trim() || `Page-${i + 1}`;
      const qrPng = await QRCode.toBuffer(qrContent, { margin: 1, width: 300 });
      const qrImage = await srcDoc.embedPng(qrPng);
      page.drawImage(qrImage, { x, y, width: size, height: size });

      const detailFilled = fillTemplate(detailText, data);
      if (detailFilled.trim()) {
        const lines = detailFilled.split("\n");
        lines.forEach((line, li) => {
          page.drawText(line, {
            x: x + size + 10,
            y: y + size - 12 - li * (fSize + 3),
            size: fSize,
            font,
            color: rgb(0, 0, 0),
          });
        });
      }
    }

    // Sorting: build the new page order, then copy into a fresh document
    let order = fields.map((_, i) => i);
    if (sortBy !== "none") {
      order.sort((a, b) => {
        let va = fields[a][sortBy] ?? "";
        let vb = fields[b][sortBy] ?? "";
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

    const outDoc = await PDFDocument.create();
    const copiedPages = await outDoc.copyPages(srcDoc, order);
    copiedPages.forEach((p) => outDoc.addPage(p));
    const outBytes = await outDoc.save();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="labels_processed.pdf"'
    );
    res.send(Buffer.from(outBytes));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));
