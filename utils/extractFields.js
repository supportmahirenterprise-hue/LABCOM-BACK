/**
 * Extracts useful fields (SKU, Order No, Order Date, Qty, Size, Color, etc.)
 * from the raw text of each PDF page.
 *
 * Supports Meesho, Xpressbees, Delhivery, and standard e-commerce shipping labels.
 */

function get(text, regex) {
  const m = text.match(regex);
  return m ? m[1].trim() : "";
}

function extractFieldsFromPages(pageTexts) {
  return pageTexts.map((rawText, idx) => {
    const text = rawText || "";
    const lines = text
      .split(/[\r\n]+/)
      .map((l) => l.trim())
      .filter(Boolean);

    // 1. Order No
    let orderNo =
      get(text, /Purchase Order No\.?\s*[:\s]*[\r\n]*\s*(\S+)/i) ||
      get(text, /Order No\.?\s*[:\s]*[\r\n]*\s*(\S+)/i) ||
      get(text, /(\d{10,}_\d+|\d{10,})/) ||
      "";

    // 2. Invoice No
    let invoiceNo =
      get(text, /Invoice No\.?\s*[:\s]*[\r\n]*\s*(\S+)/i) ||
      get(text, /(INV[-_]?\w+)/i) ||
      "";

    // 3. Customer Name
    let customerName =
      get(text, /Customer Address\s*[\r\n]+\s*([^\r\n]+)/i) ||
      get(text, /BILL TO\s*[:\s]*[\r\n]*\s*([^\r\n]+)/i) ||
      "";

    // 4. Order Date
    let orderDate =
      get(text, /Order Date\s+Invoice Date\s*[\r\n]+\s*(\d{2}[.\/]\d{2}[.\/]\d{4})/i) ||
      get(text, /Order Date\s*[:\s]*[\r\n]*\s*(\d{2}[.\/]\d{2}[.\/]\d{4})/i) ||
      get(text, /(\d{2}[.\/]\d{2}[.\/]\d{4})/) ||
      "";

    // 5. Product Details Block Parser (SKU, Size, Qty, Color)
    let sku = "";
    let size = "";
    let qty = "";
    let color = "";

    // Check single-line combined table row first
    const lineMatch = text.match(
      /SKU\s+Size\s+Qty\s+Color\s+Order No\.?\s*[\r\n]+([^\r\n]+)/i
    );
    if (lineMatch) {
      const tokens = lineMatch[1].trim().split(/\s+/);
      const orderNoTokIdx = tokens.findIndex((t) => /^\d{6,}(_\d+)?$/.test(t));
      sku = tokens[0] || "";

      let qtyIdx = -1;
      for (let i = 1; i < tokens.length; i++) {
        if (
          /^\d+$/.test(tokens[i]) &&
          (orderNoTokIdx === -1 || i < orderNoTokIdx)
        ) {
          qtyIdx = i;
          break;
        }
      }
      if (qtyIdx > -1) {
        size = tokens.slice(1, qtyIdx).join(" ");
        qty = tokens[qtyIdx];
        color =
          orderNoTokIdx > -1
            ? tokens.slice(qtyIdx + 1, orderNoTokIdx).join(" ")
            : tokens[qtyIdx + 1] || "";
      }
      if (!orderNo && orderNoTokIdx > -1) orderNo = tokens[orderNoTokIdx];
    }

    // Multi-line / Newline-separated table block parser (standard in Meesho pdf-parse)
    if (!sku || !qty) {
      let prodIdx = lines.findIndex((l) => /Product Details/i.test(l));
      if (prodIdx === -1) {
        prodIdx = lines.findIndex((l) => /^SKU$/i.test(l) || /SKU\s+Size/i.test(l));
      }

      if (prodIdx !== -1) {
        const sectionLines = [];
        for (let i = prodIdx; i < Math.min(lines.length, prodIdx + 20); i++) {
          if (/TAX INVOICE|BILL TO|SOLD BY/i.test(lines[i]) && i > prodIdx + 2) {
            break;
          }
          sectionLines.push(lines[i]);
        }

        const headerRegex = /^(Product Details|SKU|Size|Qty|Color|Order No\.?|Quantity)$/i;
        const dataTokens = sectionLines.filter((l) => !headerRegex.test(l));

        if (dataTokens.length > 0) {
          if (!sku) sku = dataTokens[0] || "";

          for (let i = 1; i < dataTokens.length; i++) {
            const tok = dataTokens[i];
            if (/^\d+$/.test(tok) && parseInt(tok, 10) < 1000) {
              if (!qty) qty = tok;
              if (!size) size = dataTokens.slice(1, i).join(" ");
              if (!color) color = dataTokens.slice(i + 1).join(" ");
              break;
            }
          }
        }
      }
    }

    // Direct Qty regex fallbacks
    if (!qty) {
      const qm =
        text.match(/Qty\s*[:\s]*[\r\n]+\s*(\d+)/i) ||
        text.match(/Quantity\s*[:\s]*[\r\n]+\s*(\d+)/i) ||
        text.match(/Qty\s*[:=\s]+(\d+)/i) ||
        text.match(/Total Items\s*[:\s]*(\d+)/i);
      if (qm) qty = qm[1];
    }

    // Default Qty to "1" if still empty so sorting and analytics always work accurately
    if (!qty) {
      qty = "1";
    }

    return {
      page: idx + 1,
      orderNo,
      orderDate,
      invoiceNo,
      customerName,
      sku,
      size,
      qty,
      color,
    };
  });
}

module.exports = { extractFieldsFromPages };
