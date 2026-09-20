/**
 * Robust zero-dependency CSV parser supporting quoted strings, commas inside quotes,
 * doubled quote escapes, and auto header detection.
 */
function parseCsv(csvText) {
  if (!csvText) return [];

  // Remove UTF-8 BOM if present
  const cleanText = csvText.replace(/^\uFEFF/, "");

  const rows = [];
  let currentRow = [];
  let currentToken = "";
  let insideQuotes = false;

  for (let i = 0; i < cleanText.length; i++) {
    const char = cleanText[i];
    const nextChar = cleanText[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentToken += '"';
        i++; // Skip escaped quote
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === "," && !insideQuotes) {
      currentRow.push(currentToken.trim());
      currentToken = "";
    } else if ((char === "\r" || char === "\n") && !insideQuotes) {
      if (char === "\r" && nextChar === "\n") {
        i++; // Skip \n after \r
      }
      currentRow.push(currentToken.trim());
      if (currentRow.some((col) => col.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentToken = "";
    } else {
      currentToken += char;
    }
  }

  if (currentToken.length > 0 || currentRow.length > 0) {
    currentRow.push(currentToken.trim());
    if (currentRow.some((col) => col.length > 0)) {
      rows.push(currentRow);
    }
  }

  if (rows.length === 0) return [];

  // Find header row by searching for common Meesho Return CSV headers
  let headerIdx = rows.findIndex((r) =>
    r.some(
      (col) =>
        /Suborder Number|Sub Order|Suborder|Order Number|Type of Return|Return Reason|AWB Number/i.test(
          col
        )
    )
  );

  if (headerIdx === -1) headerIdx = 0;

  const headers = rows[headerIdx].map((h) =>
    h.replace(/^"+|"+$/g, "").trim()
  );
  const dataRows = rows.slice(headerIdx + 1);

  return dataRows.map((row) => {
    const obj = {};
    headers.forEach((h, idx) => {
      const val = row[idx] !== undefined ? row[idx].replace(/^"+|"+$/g, "").trim() : "";
      obj[h] = val;
    });
    return obj;
  });
}

module.exports = { parseCsv };
