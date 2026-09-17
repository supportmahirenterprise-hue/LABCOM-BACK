const { createCanvas } = require("@napi-rs/canvas");

function generateSummaryCanvasImage(pagesData, sourceFileName = "labels.pdf") {
  const skuMap = {};
  let totalQtySum = 0;
  const multiQtyOrders = [];
  const stateMap = {};

  pagesData.forEach((item, idx) => {
    const sku = (item.sku || "UNSPECIFIED_SKU").trim();
    const qtyVal = parseInt(item.qty, 10) || 1;
    const state = (item.state || "India").trim();
    totalQtySum += qtyVal;

    if (!skuMap[sku]) {
      skuMap[sku] = { sku, totalOrders: 0, totalQty: 0, multiQtyCount: 0 };
    }
    skuMap[sku].totalOrders += 1;
    skuMap[sku].totalQty += qtyVal;

    if (qtyVal > 1) {
      skuMap[sku].multiQtyCount += 1;
      multiQtyOrders.push({
        page: item.page || idx + 1,
        orderNo: item.subOrderNo || item.orderNo || "N/A",
        sku,
        qty: qtyVal,
        name: item.customerName || "N/A",
      });
    }

    stateMap[state] = (stateMap[state] || 0) + 1;
  });

  const skuList = Object.values(skuMap).sort((a, b) => b.totalQty - a.totalQty);
  const stateList = Object.entries(stateMap).sort((a, b) => b[1] - a[1]);

  const width = 850;
  const rowH = 36;
  const headerH = 95;
  const statsH = 90;
  const skuTableH = 50 + Math.max(skuList.length, 1) * rowH;
  const multiTableH = multiQtyOrders.length > 0 ? 55 + Math.min(multiQtyOrders.length, 12) * rowH : 0;
  const stateTableH = 55 + Math.min(stateList.length, 8) * rowH;
  const totalH = headerH + statsH + skuTableH + multiTableH + stateTableH + 60;

  const canvas = createCanvas(width, totalH);
  const ctx = canvas.getContext("2d");

  // Dark Theme Background
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, width, totalH);

  // Header Banner
  ctx.fillStyle = "#1e293b";
  ctx.fillRect(0, 0, width, 85);

  ctx.fillStyle = "#0284c7";
  ctx.fillRect(0, 0, 10, 85);

  ctx.fillStyle = "#38bdf8";
  ctx.font = "bold 24px sans-serif";
  ctx.fillText("ORDER & SKU BATCH SUMMARY REPORT", 35, 42);

  const cleanFileName = sourceFileName.replace(/\.pdf$/i, "");
  ctx.fillStyle = "#94a3b8";
  ctx.font = "14px sans-serif";
  ctx.fillText(`File: ${cleanFileName}.pdf  |  Generated: ${new Date().toLocaleString("en-IN")}`, 35, 70);

  // 4 KPI Stat Cards
  const stats = [
    { label: "TOTAL LABELS", val: String(pagesData.length), color: "#38bdf8" },
    { label: "TOTAL PIECES", val: String(totalQtySum), color: "#10b981" },
    { label: "UNIQUE SKUS", val: String(skuList.length), color: "#a855f7" },
    { label: "MULTI-QTY ORDERS", val: String(multiQtyOrders.length), color: "#f59e0b" },
  ];

  let currX = 35;
  const cardW = 180;
  stats.forEach((s) => {
    ctx.fillStyle = "#1e293b";
    if (ctx.roundRect) ctx.roundRect(currX, 105, cardW, 64, 8);
    else ctx.fillRect(currX, 105, cardW, 64);
    ctx.fill();

    ctx.strokeStyle = s.color;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = "#94a3b8";
    ctx.font = "bold 11px sans-serif";
    ctx.fillText(s.label, currX + 14, 126);

    ctx.fillStyle = s.color;
    ctx.font = "bold 22px sans-serif";
    ctx.fillText(s.val, currX + 14, 155);

    currX += cardW + 15;
  });

  // 1. SKU Summary Table
  let currY = 205;
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 16px sans-serif";
  ctx.fillText("📦 SKU DISPATCH SUMMARY", 35, currY);
  currY += 15;

  ctx.fillStyle = "#0284c7";
  ctx.fillRect(35, currY, width - 70, 32);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 12px sans-serif";
  ctx.fillText("#", 50, currY + 20);
  ctx.fillText("SKU CODE", 90, currY + 20);
  ctx.fillText("TOTAL ORDERS", 450, currY + 20);
  ctx.fillText("TOTAL QTY", 580, currY + 20);
  ctx.fillText("MULTI-QTY ORDERS", 690, currY + 20);
  currY += 32;

  skuList.forEach((item, idx) => {
    ctx.fillStyle = idx % 2 === 0 ? "#1e293b" : "#0f172a";
    ctx.fillRect(35, currY, width - 70, rowH);

    ctx.fillStyle = "#94a3b8";
    ctx.font = "13px sans-serif";
    ctx.fillText(String(idx + 1), 50, currY + 22);

    ctx.fillStyle = "#38bdf8";
    ctx.font = "bold 13px monospace";
    ctx.fillText(item.sku, 90, currY + 22);

    ctx.fillStyle = "#ffffff";
    ctx.font = "13px sans-serif";
    ctx.fillText(String(item.totalOrders), 450, currY + 22);

    ctx.fillStyle = "#10b981";
    ctx.font = "bold 13px sans-serif";
    ctx.fillText(String(item.totalQty), 580, currY + 22);

    ctx.fillStyle = item.multiQtyCount > 0 ? "#f59e0b" : "#94a3b8";
    ctx.fillText(String(item.multiQtyCount), 690, currY + 22);

    currY += rowH;
  });

  // 2. Multi-Qty Orders Table (if present)
  if (multiQtyOrders.length > 0) {
    currY += 25;
    ctx.fillStyle = "#f59e0b";
    ctx.font = "bold 16px sans-serif";
    ctx.fillText("🔥 MULTI-QTY ORDERS BREAKDOWN", 35, currY);
    currY += 15;

    ctx.fillStyle = "#d97706";
    ctx.fillRect(35, currY, width - 70, 32);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 12px sans-serif";
    ctx.fillText("PAGE #", 50, currY + 20);
    ctx.fillText("SUB ORDER ID / ORDER NO", 130, currY + 20);
    ctx.fillText("SKU CODE", 430, currY + 20);
    ctx.fillText("QTY", 650, currY + 20);
    currY += 32;

    const displayMulti = multiQtyOrders.slice(0, 12);
    displayMulti.forEach((m, idx) => {
      ctx.fillStyle = idx % 2 === 0 ? "#1e293b" : "#0f172a";
      ctx.fillRect(35, currY, width - 70, rowH);

      ctx.fillStyle = "#94a3b8";
      ctx.font = "13px sans-serif";
      ctx.fillText(`Page ${m.page}`, 50, currY + 22);

      ctx.fillStyle = "#38bdf8";
      ctx.font = "bold 13px monospace";
      ctx.fillText(m.orderNo, 130, currY + 22);

      ctx.fillStyle = "#ffffff";
      ctx.font = "13px sans-serif";
      ctx.fillText(m.sku, 430, currY + 22);

      ctx.fillStyle = "#f59e0b";
      ctx.font = "bold 14px sans-serif";
      ctx.fillText(String(m.qty), 650, currY + 22);

      currY += rowH;
    });
  }

  // 3. State Wise Breakdown Table
  currY += 25;
  ctx.fillStyle = "#38bdf8";
  ctx.font = "bold 16px sans-serif";
  ctx.fillText("📍 REGIONAL STATE BREAKDOWN", 35, currY);
  currY += 15;

  ctx.fillStyle = "#0369a1";
  ctx.fillRect(35, currY, width - 70, 32);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 12px sans-serif";
  ctx.fillText("STATE / REGION", 50, currY + 20);
  ctx.fillText("TOTAL ORDERS", 450, currY + 20);
  ctx.fillText("SHARE %", 650, currY + 20);
  currY += 32;

  const displayStates = stateList.slice(0, 8);
  displayStates.forEach(([st, cnt], idx) => {
    ctx.fillStyle = idx % 2 === 0 ? "#1e293b" : "#0f172a";
    ctx.fillRect(35, currY, width - 70, rowH);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 13px sans-serif";
    ctx.fillText(`📍 ${st}`, 50, currY + 22);

    ctx.fillStyle = "#38bdf8";
    ctx.font = "13px sans-serif";
    ctx.fillText(`${cnt} Orders`, 450, currY + 22);

    const sharePct = ((cnt / pagesData.length) * 100).toFixed(1);
    ctx.fillStyle = "#10b981";
    ctx.font = "bold 13px sans-serif";
    ctx.fillText(`${sharePct}%`, 650, currY + 22);

    currY += rowH;
  });

  return canvas.toDataURL("image/png");
}

module.exports = {
  generateSummaryCanvasImage,
};
