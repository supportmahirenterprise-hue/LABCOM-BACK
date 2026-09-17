const { createCanvas } = require("@napi-rs/canvas");

function generateSummaryCanvasImage(pagesData, sourceFileName = "labels.pdf") {
  const skuMap = {};
  let totalQtySum = 0;
  const multiQtyOrders = [];

  pagesData.forEach((item, idx) => {
    const sku = (item.sku || "UNSPECIFIED_SKU").trim();
    const qtyVal = parseInt(item.qty, 10) || 1;
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
        customerName: item.customerName || "N/A",
      });
    }
  });

  const skuList = Object.values(skuMap).sort((a, b) => b.totalQty - a.totalQty);
  const totalLabels = pagesData.length;
  const totalSkus = skuList.length;
  const totalMultiQty = multiQtyOrders.length;

  const width = 820;
  const rowH = 32;
  const headerH = 80;
  const statsH = 90;
  const skuSectionH = 45 + 32 + skuList.length * rowH + 36;
  const multiSectionH =
    multiQtyOrders.length > 0
      ? 50 + 32 + Math.min(multiQtyOrders.length, 25) * rowH
      : 60;
  const totalH = headerH + statsH + skuSectionH + multiSectionH + 50;

  const canvas = createCanvas(width, totalH);
  const ctx = canvas.getContext("2d");

  // Pure White Background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, totalH);

  // 1. Dark Navy Top Header Banner
  ctx.fillStyle = "#0b192c";
  ctx.fillRect(0, 0, width, 75);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 22px sans-serif";
  ctx.fillText("ORDER & SKU BATCH SUMMARY", 35, 40);

  const cleanFileName = sourceFileName.replace(/\.pdf$/i, "");
  const genTime = new Date().toLocaleString("en-IN", {
    dateStyle: "short",
    timeStyle: "medium",
  });
  ctx.fillStyle = "#94a3b8";
  ctx.font = "12px sans-serif";
  ctx.fillText(
    `File: ${cleanFileName}.pdf  |  Generated: ${genTime}`,
    35,
    62
  );

  // Helper to draw rounded border cards
  function drawCard(x, y, w, h, borderColor, fillColor = "#ffffff") {
    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(x, y, w, h, 6);
    } else {
      ctx.rect(x, y, w, h);
    }
    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = borderColor;
    ctx.stroke();
    ctx.restore();
  }

  // 2. 4 KPI Stat Cards
  let currY = 95;
  const cardW = 172;
  const cardH = 62;
  const cardGap = 16;
  const stats = [
    { label: "TOTAL LABELS", val: String(totalLabels), color: "#0070f3" },
    { label: "TOTAL ITEM QTY", val: String(totalQtySum), color: "#10b981" },
    { label: "UNIQUE SKUs", val: String(totalSkus), color: "#8b5cf6" },
    {
      label: "MULTI-QTY (>1)",
      val: String(totalMultiQty),
      color: totalMultiQty > 0 ? "#ef4444" : "#64748b",
    },
  ];

  stats.forEach((s, idx) => {
    const cardX = 35 + idx * (cardW + cardGap);
    drawCard(cardX, currY, cardW, cardH, s.color);

    ctx.fillStyle = "#475569";
    ctx.font = "bold 10px sans-serif";
    ctx.fillText(s.label, cardX + 12, currY + 20);

    ctx.fillStyle = s.color;
    ctx.font = "bold 24px sans-serif";
    ctx.fillText(s.val, cardX + 12, currY + 48);
  });

  currY += cardH + 30;

  // 3. Section Title: SKU ORDER BREAKDOWN
  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 14px sans-serif";
  ctx.fillText("1. SKU ORDER BREAKDOWN", 35, currY);
  currY += 14;

  // Table 1 Header
  const colX = [35, 80, 420, 530, 640];
  const colW = [45, 340, 110, 110, 145];
  const tableWidth = width - 70;

  ctx.fillStyle = "#1e3a8a"; // Dark navy header
  ctx.fillRect(35, currY, tableWidth, 30);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 11px sans-serif";
  ctx.fillText("S.No", colX[0] + 6, currY + 19);
  ctx.fillText("SKU Name / Description", colX[1] + 6, currY + 19);
  ctx.fillText("Total Orders", colX[2] + 6, currY + 19);
  ctx.fillText("Total Qty", colX[3] + 6, currY + 19);
  ctx.fillText("Multi-Qty (>1)", colX[4] + 6, currY + 19);

  currY += 30;

  // Table 1 Rows
  skuList.forEach((item, idx) => {
    const isEven = idx % 2 === 0;
    ctx.fillStyle = isEven ? "#ffffff" : "#f8fafc";
    ctx.fillRect(35, currY, tableWidth, rowH);

    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 0.5;
    ctx.strokeRect(35, currY, tableWidth, rowH);

    // S.No
    ctx.fillStyle = "#475569";
    ctx.font = "11px sans-serif";
    ctx.fillText(String(idx + 1), colX[0] + 6, currY + 20);

    // SKU Name
    let skuText = item.sku;
    if (skuText.length > 50) skuText = skuText.substring(0, 47) + "...";
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 11px sans-serif";
    ctx.fillText(skuText, colX[1] + 6, currY + 20);

    // Total Orders
    ctx.fillStyle = "#334155";
    ctx.font = "11px sans-serif";
    ctx.fillText(String(item.totalOrders), colX[2] + 6, currY + 20);

    // Total Qty
    ctx.fillStyle = "#10b981";
    ctx.font = "bold 11px sans-serif";
    ctx.fillText(String(item.totalQty), colX[3] + 6, currY + 20);

    // Multi-Qty Count
    ctx.fillStyle = item.multiQtyCount > 0 ? "#ef4444" : "#64748b";
    ctx.font = item.multiQtyCount > 0 ? "bold 11px sans-serif" : "11px sans-serif";
    ctx.fillText(
      item.multiQtyCount > 0 ? `${item.multiQtyCount} Orders` : "0",
      colX[4] + 6,
      currY + 20
    );

    currY += rowH;
  });

  // Table 1 Total Summary Row
  ctx.fillStyle = "#e0f2fe"; // Light blue summary row
  ctx.fillRect(35, currY, tableWidth, 34);

  ctx.strokeStyle = "#93c5fd";
  ctx.lineWidth = 1;
  ctx.strokeRect(35, currY, tableWidth, 34);

  ctx.fillStyle = "#1e3a8a";
  ctx.font = "bold 12px sans-serif";
  ctx.fillText("TOTAL BATCH SUMMARY", colX[1] + 6, currY + 22);

  ctx.fillStyle = "#1e3a8a";
  ctx.font = "bold 12px sans-serif";
  ctx.fillText(String(totalLabels), colX[2] + 6, currY + 22);

  ctx.fillStyle = "#10b981";
  ctx.font = "bold 12px sans-serif";
  ctx.fillText(String(totalQtySum), colX[3] + 6, currY + 22);

  ctx.fillStyle = totalMultiQty > 0 ? "#ef4444" : "#1e3a8a";
  ctx.font = "bold 12px sans-serif";
  ctx.fillText(String(totalMultiQty), colX[4] + 6, currY + 22);

  currY += 34 + 30;

  // 4. Section 2: Multi-Qty Breakdown OR Single Qty Alert Box
  if (multiQtyOrders.length > 0) {
    // Red Alert Header Banner
    drawCard(35, currY, tableWidth, 30, "#ef4444", "#fef2f2");
    ctx.fillStyle = "#dc2626";
    ctx.font = "bold 11px sans-serif";
    ctx.fillText(
      "MULTI-QUANTITY ORDERS (QTY > 1) - HIGHLIGHTED PACKING ALERT",
      45,
      currY + 19
    );

    currY += 34;

    // Multi-Qty Table Header
    const mColX = [35, 95, 270, 520, 630];
    ctx.fillStyle = "#b91c1c";
    ctx.fillRect(35, currY, tableWidth, 28);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 11px sans-serif";
    ctx.fillText("Page #", mColX[0] + 6, currY + 18);
    ctx.fillText("Order Number", mColX[1] + 6, currY + 18);
    ctx.fillText("SKU Name", mColX[2] + 6, currY + 18);
    ctx.fillText("QUANTITY", mColX[3] + 6, currY + 18);
    ctx.fillText("Customer Name", mColX[4] + 6, currY + 18);

    currY += 28;

    const displayMulti = multiQtyOrders.slice(0, 25);
    displayMulti.forEach((m, idx) => {
      const isEven = idx % 2 === 0;
      ctx.fillStyle = isEven ? "#fff5f5" : "#fef2f2";
      ctx.fillRect(35, currY, tableWidth, rowH);

      ctx.strokeStyle = "#fca5a5";
      ctx.lineWidth = 0.5;
      ctx.strokeRect(35, currY, tableWidth, rowH);

      // Page #
      ctx.fillStyle = "#0f172a";
      ctx.font = "bold 11px sans-serif";
      ctx.fillText(`Page ${m.page}`, mColX[0] + 6, currY + 20);

      // Order No
      ctx.fillStyle = "#1e293b";
      ctx.font = "11px sans-serif";
      ctx.fillText(String(m.orderNo), mColX[1] + 6, currY + 20);

      // SKU Name
      let skuText = m.sku;
      if (skuText.length > 32) skuText = skuText.substring(0, 29) + "...";
      ctx.fillStyle = "#0f172a";
      ctx.font = "bold 11px sans-serif";
      ctx.fillText(skuText, mColX[2] + 6, currY + 20);

      // QTY Badge Pill
      ctx.fillStyle = "#dc2626";
      if (ctx.roundRect) ctx.roundRect(mColX[3] + 4, currY + 6, 60, 20, 4);
      else ctx.fillRect(mColX[3] + 4, currY + 6, 60, 20);
      ctx.fill();

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 11px sans-serif";
      ctx.fillText(`QTY: ${m.qty}`, mColX[3] + 12, currY + 20);

      // Customer Name
      let custText = m.customerName;
      if (custText.length > 20) custText = custText.substring(0, 17) + "...";
      ctx.fillStyle = "#475569";
      ctx.font = "11px sans-serif";
      ctx.fillText(custText, mColX[4] + 6, currY + 20);

      currY += rowH;
    });
  } else {
    // Single Qty Green Alert Box (Matching User's Uploaded Screenshot Exactly)
    drawCard(35, currY, tableWidth, 38, "#10b981", "#ecfdf5");

    ctx.fillStyle = "#059669";
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(
      "ALL ORDERS ARE SINGLE QUANTITY (QTY = 1) - No multi-quantity packing alerts.",
      width / 2,
      currY + 23
    );
    ctx.textAlign = "left"; // reset alignment
  }

  return canvas.toDataURL("image/png");
}

module.exports = {
  generateSummaryCanvasImage,
};
