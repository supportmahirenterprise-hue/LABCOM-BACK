/**
 * Extracts useful fields (SKU, Order No, Order Date, Qty, Size, Color, State, Regional Greeting)
 * from the raw text of each PDF page.
 *
 * Supports Meesho, Xpressbees, Delhivery, and standard e-commerce shipping labels.
 */
const { resolveRegionalGreeting } = require("./regionalMessages");

function get(text, regex) {
  const m = text.match(regex);
  return m ? m[1].trim() : "";
}

function extractFieldsFromPages(pageTexts, useNativeScript = false, startPageOffset = 1) {
  return pageTexts.map((rawText, idx) => {
    const text = rawText || "";
    const lines = text
      .split(/[\r\n]+/)
      .map((l) => l.trim())
      .filter(Boolean);


    // 1. Order No & Sub Order ID
    let subOrderNo =
      get(text, /Order No\.?\s*[:\s]*[\r\n]*\s*(\d{10,}_\d+)/i) ||
      (text.match(/\b(\d{10,}_\d+)\b/) ? text.match(/\b(\d{10,}_\d+)\b/)[1] : "") ||
      get(text, /Sub\s*Order\s*(?:No|ID)\.?\s*[:\s]*[\r\n]*\s*(\S+)/i) ||
      "";

    let orderNo =
      get(text, /Purchase Order No\.?\s*[:\s]*[\r\n]*\s*(\S+)/i) ||
      (subOrderNo ? subOrderNo.split("_")[0] : "") ||
      get(text, /Order No\.?\s*[:\s]*[\r\n]*\s*(\S+)/i) ||
      get(text, /(\d{10,})/) ||
      "";

    if (!subOrderNo) {
      subOrderNo = orderNo;
    }

    // 2. Invoice No
    let invoiceNo =
      get(text, /Invoice No\.?\s*[:\s]*[\r\n]*\s*(\S+)/i) ||
      get(text, /(INV[-_]?\w+)/i) ||
      "";

    // 3. Customer Name, Address & Mobile Number
    let customerName =
      get(text, /Customer Address\s*[\r\n]+\s*([^\r\n]+)/i) ||
      get(text, /BILL TO\s*[:\s]*[\r\n]*\s*([^\r\n]+)/i) ||
      "";

    // Extract full customer address block
    let customerAddress = "";
    const addrMatch = text.match(/Customer Address\s*[:\s]*([\s\S]*?)(?:If undelivered|return to|Sold by|Product Details|TAX INVOICE|BILL TO|Shipping Address)/i);
    if (addrMatch && addrMatch[1].trim().length > 10) {
      customerAddress = addrMatch[1].trim().replace(/[\r\n]+/g, ", ");
    } else {
      customerAddress = customerName || "N/A";
    }

    // Extract Mobile / Contact Number (if present)
    let mobileNumber = "";
    const mobMatch =
      text.match(/(?:Mob(?:ile)?|Phone|Tel|Contact)\s*[:.\s]*(\+?91[\s-]?)?([6-9]\d{9})/i) ||
      text.match(/\b([6-9]\d{9})\b/);
    if (mobMatch) {
      mobileNumber = mobMatch[2] || mobMatch[1] || "";
    }

    // 4. Order Date
    let orderDate =
      get(text, /Order Date\s+Invoice Date\s*[\r\n]+\s*(\d{2}[.\/]\d{2}[.\/]\d{4})/i) ||
      get(text, /Order Date\s*[:\s]*[\r\n]*\s*(\d{2}[.\/]\d{2}[.\/]\d{4})/i) ||
      get(text, /(\d{2}[.\/]\d{2}[.\/]\d{4})/) ||
      "";

    // 4b. Payment Type Detection (COD vs Prepaid)
    let paymentType = "COD";
    const isCodExplicit = /\bCOD\b|Cash\s*on\s*Delivery/i.test(text);
    const isPrepaidExplicit = /Prepaid|Pre-paid|\bPAID\b/i.test(text);
    const isZeroCollect = /Collect(?:able)?\s*(?:Amount|Rs\.?)?\s*[:\s]*[₹Rs.]*\s*0\b/i.test(text) || /COD\s*Amount\s*[:\s]*[₹Rs.]*\s*0\b/i.test(text);

    if (isZeroCollect || (isPrepaidExplicit && !isCodExplicit)) {
      paymentType = "Prepaid";
    } else if (isCodExplicit) {
      paymentType = "COD";
    } else if (isPrepaidExplicit) {
      paymentType = "Prepaid";
    } else {
      paymentType = "COD";
    }

    // 5. Product Details Block Parser (SKU, Size, Qty, Color)
    let sku = "";
    let size = "";
    let qty = "";
    let color = "";

    // Check single-line combined table row first
    const productLine = lines.find((l) =>
      /^\d+\s+\S+/.test(l) ||
      /SKU|Style|Item|Product/i.test(l)
    );

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

    // 6. Regional State & Heartwarming Greeting Resolver
    const regionalInfo = resolveRegionalGreeting(text, useNativeScript);

    return {
      page: idx + 1,
      orderNo,
      subOrderNo,
      paymentType,
      orderDate,
      invoiceNo,
      customerName,
      customerAddress,
      mobileNumber,
      sku,
      size,
      qty,
      color,
      state: regionalInfo.state,
      regionalThankYou: regionalInfo.regionalThankYou,
      regionalThankYouLatin: regionalInfo.regionalThankYouLatin,
      regionalThankYouNative: regionalInfo.regionalThankYouNative,
      regionalLanguage: regionalInfo.regionalLanguage,
    };
  });
}

module.exports = { extractFieldsFromPages };
