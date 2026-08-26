/**
 * Extracts useful fields (SKU, Order No, Order Date, Qty, Size, Color, etc.)
 * from the raw text of each PDF page.
 *
 * NOTE: Shipping-label PDFs (Meesho / Xpress Bees / Delhivery / Shiprocket etc.)
 * don't all use the exact same text layout. These regexes are tuned to the
 * common "Meesho style" label + tax invoice combo, but are written
 * defensively so a missing field just comes back as "" instead of crashing.
 * The frontend lets the user review & correct any field before generating
 * the final PDF, so imperfect extraction is not a blocker.
 */

function get(text, regex) {
  const m = text.match(regex);
  return m ? m[1].trim() : "";
}

function extractFieldsFromPages(pageTexts) {
  return pageTexts.map((rawText, idx) => {
    const text = rawText || "";

    let orderNo = get(text, /Purchase Order No\.?\s*[\r\n]+\s*(\S+)/i);
    let invoiceNo = get(text, /Invoice No\.?\s*[\r\n]+\s*(\S+)/i);
    let customerName = get(text, /Customer Address\s*[\r\n]+\s*([^\r\n]+)/i);

    let orderDate =
      get(
        text,
        /Order Date\s+Invoice Date\s*[\r\n]+\s*(\d{2}[.\/]\d{2}[.\/]\d{4})/i
      ) || get(text, /Order Date[:\s]*[\r\n]*\s*(\d{2}[.\/]\d{2}[.\/]\d{4})/i);

    let sku = "",
      size = "",
      qty = "",
      color = "";

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

    if (!orderNo) {
      const m = text.match(/(\d{10,}_\d+)/);
      if (m) orderNo = m[1];
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
