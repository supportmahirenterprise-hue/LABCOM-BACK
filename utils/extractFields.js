/**
 * Multi-Marketplace Field Extraction Engine
 * Supports Meesho, Flipkart, Amazon, and standard Indian logistics labels (Ekart, ATS, Delhivery, Xpressbees, Shadowfax).
 */
const { resolveRegionalGreeting } = require("./regionalMessages");

const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa",
  "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala",
  "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland",
  "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
  "Uttar Pradesh", "Uttarakhand", "West Bengal", "Delhi", "Jammu and Kashmir",
  "Ladakh", "Chandigarh", "Andaman and Nicobar Islands",
  "Dadra and Nagar Haveli and Daman and Diu", "Lakshadweep", "Puducherry"
];

const IN_CODE_STATE = {
  UP: "Uttar Pradesh", MH: "Maharashtra", KA: "Karnataka", GJ: "Gujarat",
  DL: "Delhi", WB: "West Bengal", TN: "Tamil Nadu", TG: "Telangana",
  TS: "Telangana", AP: "Andhra Pradesh", KL: "Kerala", MP: "Madhya Pradesh",
  RJ: "Rajasthan", BR: "Bihar", PB: "Punjab", HR: "Haryana", OR: "Odisha",
  OD: "Odisha", AS: "Assam", JH: "Jharkhand", CG: "Chhattisgarh",
  CT: "Chhattisgarh", GA: "Goa", HP: "Himachal Pradesh", UT: "Uttarakhand",
  UK: "Uttarakhand", JK: "Jammu and Kashmir", CH: "Chandigarh", PY: "Puducherry",
  TR: "Tripura", ML: "Meghalaya", MN: "Manipur", NL: "Nagaland", MZ: "Mizoram",
  SK: "Sikkim", AR: "Arunachal Pradesh", LA: "Ladakh", AN: "Andaman and Nicobar Islands",
  LD: "Lakshadweep", DN: "Dadra and Nagar Haveli and Daman and Diu",
  DD: "Dadra and Nagar Haveli and Daman and Diu"
};

function get(text, regex) {
  if (!text) return "";
  const m = text.match(regex);
  return m && m[1] ? m[1].trim() : "";
}

function detectStateInText(text) {
  if (!text) return "";
  for (const st of INDIAN_STATES) {
    const rx = new RegExp("\\b" + st.replace(/ /g, "\\s+") + "\\b", "i");
    if (rx.test(text)) return st;
  }
  return "";
}

/**
 * Auto-detects the marketplace from page text.
 * Checked in priority order: Amazon -> Flipkart -> Meesho.
 */
function detectPlatform(text) {
  const t = text || "";
  // 1. Amazon: 3-7-7 Order ID, ASIN keyword, or Payment/Delivery pairs
  if (
    /\b\d{3}-\d{7}-\d{7}\b/.test(t) ||
    /\bASIN\b/i.test(t) ||
    (/Mode of Payment/i.test(t) && /Place of delivery/i.test(t))
  ) {
    return "amazon";
  }

  // 2. Flipkart: OD order number, Ekart, AWB F..., or Ordered through
  if (
    /\bOD\d{14,}\b/.test(t) ||
    (/E-?\s*Kart/i.test(t) && /Ordered through/i.test(t)) ||
    /AWB\s*No\.?\s*F/i.test(t) ||
    (/\bOD\d{10,}\b/.test(t) && /Tax Invoice/i.test(t))
  ) {
    return "flipkart";
  }

  // 3. Meesho: Customer Address, If undelivered return to, or Sub-Order pattern (\d{10,}_\d+)
  if (
    /Customer\s+Address/i.test(t) ||
    /If undelivered,?\s*return to/i.test(t) ||
    /\b\d{10,}_\d+\b/.test(t)
  ) {
    return "meesho";
  }

  // Default fallback to Meesho for backward compatibility
  return "meesho";
}

function parseFlipkartPage(text, lines, regionalInfo, actualPageNumber) {
  const flat = text.replace(/\s+/g, " ").trim();

  // 1. Order Number (OD...)
  const om = flat.match(/\bOD\d{10,}\b/);
  const orderNo = om ? om[0] : "";
  const subOrderNo = orderNo;

  // 2. Courier
  let courier = "Other";
  if (/E-?\s*Kart/i.test(text)) courier = "Ekart";
  else if (/Blue\s*Dart/i.test(text)) courier = "Blue Dart";
  else if (/Delhivery/i.test(text)) courier = "Delhivery";
  else if (/Xpress\s*Bees/i.test(text)) courier = "Xpressbees";
  else if (/Ecom\s*Express/i.test(text)) courier = "Ecom Express";
  else if (/Shadowfax/i.test(text)) courier = "Shadowfax";

  // 3. Payment
  const paymentType = /\bCOD\b|Cash on Delivery/i.test(text) ? "COD" : "Prepaid";

  // 4. SKU
  let sku = "";
  const sm = flat.match(/SKU\s*ID\s*\|\s*Description\s*QTY\s+([^|]+?)\s*\|/i);
  if (sm) {
    sku = sm[1].replace(/^\d+\s*/, "").trim().slice(0, 80);
  }
  if (!sku) {
    const fm = flat.match(/\bFSN\b[:\s]+([A-Z0-9]+)/i);
    if (fm) sku = fm[1].trim();
  }
  if (!sku) {
    const skuLine = lines.find((l) => /SKU\b/i.test(l));
    if (skuLine) sku = skuLine.replace(/SKU[:\s]*/i, "").trim();
  }

  // 5. Quantity
  const qm = flat.match(/TOTAL\s*QTY:?\s*(\d+)/i) || flat.match(/QTY\s*:?\s*(\d+)/i);
  const qty = qm ? (parseInt(qm[1], 10) || 1).toString() : "1";

  // 6. Customer Name & Address
  let customerName = "";
  let customerAddress = "";
  const addrMatch = text.match(/(?:Shipping Address|Deliver To|Ship To|Buyer Address)\s*[:\s]*([\s\S]*?)(?:Sold By|If undelivered|Return to|Tax Invoice|Product Details|BILL TO|SKU\s*ID)/i);
  if (addrMatch && addrMatch[1].trim().length > 5) {
    customerAddress = addrMatch[1].trim().replace(/[\r\n]+/g, ", ");
    const nameMatch = addrMatch[1].trim().split(/[\r\n,]+/)[0];
    customerName = (nameMatch || "").trim().slice(0, 50);
  } else {
    customerName = get(text, /(?:Deliver to|Shipping Address|Buyer)\s*[:\s]*[\r\n]*([^\r\n,]+)/i) || "Customer";
    customerAddress = customerName;
  }

  // 7. Mobile
  let mobileNumber = "";
  const mobMatch =
    text.match(/(?:Mob(?:ile)?|Phone|Tel|Contact)\s*[:.\s]*(\+?91[\s-]?)?([6-9]\d{9})/i) ||
    text.match(/\b([6-9]\d{9})\b/);
  if (mobMatch) {
    mobileNumber = mobMatch[2] || mobMatch[1] || "";
  }

  // 8. State
  let state = "";
  const cm = text.match(/IN-([A-Z]{2})\b/);
  if (cm && IN_CODE_STATE[cm[1]]) {
    state = IN_CODE_STATE[cm[1]];
  }
  if (!state) state = detectStateInText(customerAddress) || regionalInfo.state || "India";

  // 9. Order Date
  const od = flat.match(/Order Date\s*:?\s*(\d{1,2})-(\d{1,2})-(\d{4})/i) || flat.match(/(\d{2}[.\/]\d{2}[.\/]\d{4})/);
  const orderDate = od ? od[0] : "";

  return {
    page: actualPageNumber,
    platform: "flipkart",
    orderNo,
    subOrderNo,
    paymentType,
    orderDate,
    invoiceNo: get(text, /Invoice No\.?\s*[:\s]*[\r\n]*\s*(\S+)/i) || "",
    customerName,
    customerAddress,
    mobileNumber,
    sku,
    size: "",
    qty,
    color: "",
    state,
    courier,
    regionalThankYou: regionalInfo.regionalThankYou,
    regionalThankYouLatin: regionalInfo.regionalThankYouLatin,
    regionalThankYouNative: regionalInfo.regionalThankYouNative,
    regionalLanguage: regionalInfo.regionalLanguage,
  };
}

function parseAmazonPage(text, lines, regionalInfo, actualPageNumber) {
  const flat = text.replace(/\s+/g, " ").trim();

  // 1. Order Number (3-7-7)
  const om = flat.match(/\b(\d{3}-\d{7}-\d{7})\b/);
  const orderNo = om ? om[1] : "";
  const subOrderNo = orderNo;

  // 2. Payment
  let paymentType = "COD";
  const mop = flat.match(/Mode of Payment\s*:?\s*([A-Za-z][A-Za-z ]{1,24})/i);
  const method = mop ? mop[1].trim() : "";
  if (/\b(Cash on Delivery|COD|Pay on Delivery)\b/i.test(text) || /\bcash\b/i.test(method)) {
    paymentType = "COD";
  } else if (/\b(UPI|Credit|Debit|Net\s*Banking|EMI|Wallet|Gift|Prepaid|Card|Bank|Rupay|Amazon\s*Pay)\b/i.test(method)) {
    paymentType = "Prepaid";
  }

  // 3. Courier
  let courier = "ATS";
  if (/Delhivery/i.test(text)) courier = "Delhivery";
  else if (/Blue\s*Dart/i.test(text)) courier = "Blue Dart";
  else if (/Ecom\s*Express/i.test(text)) courier = "Ecom Express";

  // 4. SKU
  let sku = "";
  for (const m of flat.matchAll(/\(([^)]{2,120})\)/g)) {
    const toks = m[1].trim().split(/\s+/).filter(t => /^[A-Za-z0-9][A-Za-z0-9_\-]*$/.test(t) && t.includes("_"));
    if (toks.length) { sku = toks[toks.length - 1]; break; }
  }
  if (!sku) {
    const asinMatch = flat.match(/\bASIN\s*[:\s]*([A-Z0-9]{10})\b/i);
    if (asinMatch) sku = asinMatch[1];
  }
  if (!sku) {
    const b = flat.match(/\b([A-Za-z0-9]{2,}_\d+x\d+[A-Za-z]?)\b/);
    if (b) sku = b[1];
  }

  // 5. Quantity
  let qty = "1";
  const rows = [...flat.matchAll(/\b(\d+)\s+₹[\d,.]+\s+\d+\s*%\s*IGST/gi)];
  if (rows.length) {
    qty = (rows.reduce((s, m) => s + (parseInt(m[1], 10) || 0), 0) || 1).toString();
  } else {
    const qm = flat.match(/₹[\d,.]+\s+(\d+)\s+₹/) || flat.match(/Qty\s*:?\s*(\d+)/i);
    if (qm) qty = (parseInt(qm[1], 10) || 1).toString();
  }

  // 6. State
  let state = "";
  const pm = flat.match(/Place of delivery\s*:?\s*([A-Za-z& ]+?)\s*(?:Order|Invoice|₹|State|$)/i);
  if (pm) {
    state = detectStateInText(pm[1]) || pm[1].trim();
  }
  if (!state) state = detectStateInText(flat) || regionalInfo.state || "India";

  // 7. Customer Name & Address
  let customerName = "";
  let customerAddress = "";
  const addrMatch = text.match(/(?:Shipping Address|Deliver to|Billing Address)\s*[:\s]*([\s\S]*?)(?:Sold By|Return to|Tax Invoice|Product Details|Order Number)/i);
  if (addrMatch && addrMatch[1].trim().length > 5) {
    customerAddress = addrMatch[1].trim().replace(/[\r\n]+/g, ", ");
    const nameMatch = addrMatch[1].trim().split(/[\r\n]+/)[0];
    customerName = (nameMatch || "").trim().slice(0, 50);
  } else {
    customerName = get(text, /(?:Deliver to|Shipping Address)\s*[:\s]*[\r\n]*([^\r\n]+)/i) || "Customer";
    customerAddress = customerName;
  }

  // 8. Mobile
  let mobileNumber = "";
  const mobMatch =
    text.match(/(?:Mob(?:ile)?|Phone|Tel|Contact)\s*[:.\s]*(\+?91[\s-]?)?([6-9]\d{9})/i) ||
    text.match(/\b([6-9]\d{9})\b/);
  if (mobMatch) {
    mobileNumber = mobMatch[2] || mobMatch[1] || "";
  }

  // 9. Order Date
  const od = flat.match(/Order Date\s*:?\s*(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4})/i) || flat.match(/(\d{2}[.\/]\d{2}[.\/]\d{4})/);
  const orderDate = od ? od[0] : "";

  return {
    page: actualPageNumber,
    platform: "amazon",
    orderNo,
    subOrderNo,
    paymentType,
    orderDate,
    invoiceNo: get(text, /Invoice Number\s*[:\s]*[\r\n]*\s*(\S+)/i) || "",
    customerName,
    customerAddress,
    mobileNumber,
    sku,
    size: "",
    qty,
    color: "",
    state,
    courier,
    regionalThankYou: regionalInfo.regionalThankYou,
    regionalThankYouLatin: regionalInfo.regionalThankYouLatin,
    regionalThankYouNative: regionalInfo.regionalThankYouNative,
    regionalLanguage: regionalInfo.regionalLanguage,
  };
}

function parseMeeshoPage(text, lines, regionalInfo, actualPageNumber) {
  // 1. Order No & Sub Order ID
  let subOrderNo =
    get(text, /Order No\.?\s*[:\s]*[\r\n]*\s*(\d{10,}_\d+)/i) ||
    (text.match(/\b(\d{10,}_\d+)\b/) ? text.match(/\b(\d{10,}_\d+)\b/)[1] : "") ||
    (text.match(/(\d{10,}_\d+)/) ? text.match(/(\d{10,}_\d+)/)[1] : "") ||
    get(text, /Sub\s*Order\s*(?:No|ID)\.?\s*[:\s]*[\r\n]*\s*(\S+)/i) ||
    "";

  let orderNo =
    get(text, /Purchase Order No\.?\s*[:\s]*[\r\n]*\s*(\S+)/i) ||
    (subOrderNo ? subOrderNo.split("_")[0] : "") ||
    get(text, /Order No\.?\s*[:\s]*[\r\n]*\s*(\S+)/i) ||
    (text.match(/(\d{10,})/) ? text.match(/(\d{10,})/)[1] : "") ||
    "";

  if (!subOrderNo) {
    subOrderNo = orderNo;
  }

  // 2. Invoice No
  let invoiceNo =
    get(text, /Invoice No\.?\s*[:\s]*[\r\n]*\s*(\S+)/i) ||
    get(text, /(INV[-_]?\w+)/i) ||
    "";

  // 3. Customer Name & Address
  let customerName =
    get(text, /Customer Address\s*[:\s]*[\r\n]+\s*([^\r\n]+)/i) ||
    get(text, /BILL TO\s*[:\s]*[\r\n]*\s*([^\r\n]+)/i) ||
    "";

  let customerAddress = "";
  const addrMatch = text.match(/Customer Address\s*[:\s]*([\s\S]*?)(?:If undelivered|return to|Sold by|Product Details|TAX INVOICE|BILL TO|Shipping Address)/i);
  if (addrMatch && addrMatch[1].trim().length > 10) {
    customerAddress = addrMatch[1].trim().replace(/[\r\n]+/g, ", ");
  } else {
    customerAddress = customerName || "N/A";
  }

  if (!customerName && customerAddress && customerAddress !== "N/A") {
    customerName = customerAddress.split(",")[0].trim();
  }

  // Mobile
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

  for (const line of lines) {
    const subMatch = line.match(/(\d{10,}_\d+)/);
    if (subMatch) {
      if (!subOrderNo || subOrderNo.includes("AWB") || subOrderNo.includes("SKU")) {
        subOrderNo = subMatch[1];
        orderNo = subOrderNo.split("_")[0];
      }

      const before = line.substring(0, line.indexOf(subMatch[1]));
      const m = before.match(/^(.*?)(Free Size|Free|XXXL|XXL|XL|L|M|S|XS|NA)(\d+)(.*)$/i);
      if (m) {
        sku = m[1].trim();
        size = m[2].trim();
        qty = m[3].trim();
        color = m[4].trim();
        break;
      }
    }
  }

  if (!sku || sku.includes("SKU")) {
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
  }

  if (!sku || sku.includes("SKU") || !qty) {
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

      const headerRegex = /^(Product Details|SKU|Size|Qty|Color|Order No\.?|Quantity|SKUSizeQtyColorOrder No\.?|AWBSKUQty\.?SizePacked)$/i;
      const dataTokens = sectionLines.filter((l) => !headerRegex.test(l));

      if (dataTokens.length > 0) {
        if (!sku || sku.includes("SKU")) sku = dataTokens[0] || "";

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

  if (!qty) {
    const qm =
      text.match(/Qty\s*[:\s]*[\r\n]+\s*(\d+)/i) ||
      text.match(/Quantity\s*[:\s]*[\r\n]+\s*(\d+)/i) ||
      text.match(/Qty\s*[:=\s]+(\d+)/i) ||
      text.match(/Total Items\s*[:\s]*(\d+)/i);
    if (qm) qty = qm[1];
  }

  if (!qty) qty = "1";

  // Courier detection for Meesho
  let courier = "Other";
  if (/Valmo/i.test(text)) courier = "Valmo";
  else if (/Delhivery/i.test(text)) courier = "Delhivery";
  else if (/Shadowfax/i.test(text)) courier = "Shadowfax";
  else if (/Xpress\s*Bees/i.test(text)) courier = "Xpressbees";
  else if (/Ecom\s*Express/i.test(text)) courier = "Ecom Express";
  else if (/Ekart/i.test(text)) courier = "Ekart";

  // Resolve customer state and regional greeting strictly from customer delivery address
  let detectedState = detectStateInText(customerAddress);
  let resolvedRegional = regionalInfo;
  if (customerAddress && customerAddress.length > 5) {
    const custRegional = resolveRegionalGreeting(customerAddress, false);
    if (custRegional && custRegional.state && custRegional.state !== "India") {
      resolvedRegional = custRegional;
      detectedState = custRegional.state;
    }
  }
  if (!detectedState) {
    detectedState = resolvedRegional.state || "India";
  }

  return {
    page: actualPageNumber,
    platform: "meesho",
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
    state: detectedState,
    courier,
    regionalThankYou: resolvedRegional.regionalThankYou,
    regionalThankYouLatin: resolvedRegional.regionalThankYouLatin,
    regionalThankYouNative: resolvedRegional.regionalThankYouNative,
    regionalLanguage: resolvedRegional.regionalLanguage,
  };
}

function extractFieldsFromPages(pageTexts, useNativeScript = false, startPageOffset = 1) {
  if (!Array.isArray(pageTexts)) return [];
  return pageTexts.map((rawText, idx) => {
    const actualPageNumber = (parseInt(startPageOffset, 10) || 1) + idx;
    try {
      const text = rawText || "";
      const lines = text
        .split(/[\r\n]+/)
        .map((l) => l.trim())
        .filter(Boolean);

      const platform = detectPlatform(text);
      const regionalInfo = resolveRegionalGreeting(text, useNativeScript);

      if (platform === "flipkart") {
        return parseFlipkartPage(text, lines, regionalInfo, actualPageNumber);
      }
      if (platform === "amazon") {
        return parseAmazonPage(text, lines, regionalInfo, actualPageNumber);
      }
      return parseMeeshoPage(text, lines, regionalInfo, actualPageNumber);
    } catch (err) {
      console.error(`[extractFieldsFromPages] Error parsing page ${actualPageNumber}:`, err.message);
      return {
        page: actualPageNumber,
        platform: "meesho",
        orderNo: "",
        subOrderNo: "",
        paymentType: "COD",
        orderDate: "",
        invoiceNo: "",
        customerName: "",
        customerAddress: "",
        mobileNumber: "",
        sku: "",
        size: "",
        qty: "1",
        color: "",
        state: "India",
        courier: "Other",
        regionalThankYou: "Thank you!",
        regionalThankYouLatin: "Thank you!",
        regionalThankYouNative: "Thank you!",
        regionalLanguage: "Hindi",
      };
    }
  });
}

module.exports = { extractFieldsFromPages, detectPlatform };
