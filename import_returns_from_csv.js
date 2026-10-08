const fs = require('fs');
const readline = require('readline');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { getDb } = require('./db');

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim().replace(/^"|"$/g, ''));
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim().replace(/^"|"$/g, ''));
  return result;
}

async function importCsvReturns() {
  const csvPath = process.argv[2] || 'C:\\Users\\DREAMWORLD\\Downloads\\Orders_2026-09-01_2026-09-30_2026-10-08_16_30-16_35_4679897.csv';
  console.log(`🔍 Scanning CSV (${path.basename(csvPath)}) for RTO & Return Entries...`);

  const db = await getDb();
  const returnEntriesCol = db.collection('return_entries');
  const returnsCol = db.collection('returns');

  // Load existing return subOrderNos to avoid duplicates
  const existingReturnSubOrders = new Set();
  const [existing1, existing2] = await Promise.all([
    returnEntriesCol.find({}, { projection: { subOrderNo: 1, orderNo: 1 } }).toArray(),
    returnsCol.find({}, { projection: { subOrderNo: 1, orderNo: 1 } }).toArray(),
  ]);

  existing1.forEach(r => {
    if (r.subOrderNo) existingReturnSubOrders.add(String(r.subOrderNo).trim());
  });
  existing2.forEach(r => {
    if (r.subOrderNo) existingReturnSubOrders.add(String(r.subOrderNo).trim());
  });

  const fileStream = fs.createReadStream(csvPath, { encoding: 'utf-8' });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let lineIndex = 0;
  const returnOps = [];
  let addedCount = 0;
  let skippedCount = 0;

  for await (const line of rl) {
    lineIndex++;
    if (lineIndex === 1 || !line.trim()) continue;

    const cols = parseCsvLine(line);
    const statusReason = (cols[0] || '').trim().toUpperCase();
    const subOrderNo = (cols[1] || '').trim();
    if (!subOrderNo) continue;

    const isRtoOrReturn = /RTO|RETURN|DELIVERY_FAILED/i.test(statusReason);
    if (!isRtoOrReturn) continue;

    if (existingReturnSubOrders.has(subOrderNo)) {
      skippedCount++;
      continue;
    }

    existingReturnSubOrders.add(subOrderNo);

    const orderNo = subOrderNo.split('_')[0].trim();
    const orderDate = (cols[3] || new Date().toISOString().slice(0, 10)).trim();
    const state = (cols[5] || 'India').trim();
    const productName = (cols[6] || '').trim();
    const sku = (cols[7] || '').trim();
    const qty = parseInt(cols[9] || '1', 10) || 1;

    returnOps.push({
      insertOne: {
        document: {
          subOrderNo,
          orderNo,
          sku,
          productName,
          qty,
          returnType: 'COURIER_RTO',
          subType: statusReason,
          dispatchDate: orderDate,
          returnCreatedDate: orderDate,
          deliveredDate: orderDate,
          courierPartner: 'Courier Partner',
          awbNumber: '',
          returnReason: `Courier RTO (${statusReason})`,
          status: statusReason,
          state,
          userEmail: 'csv_import',
          createdAt: new Date(),
        }
      }
    });

    addedCount++;
  }

  if (returnOps.length > 0) {
    await returnEntriesCol.bulkWrite(returnOps, { ordered: false });
  }

  console.log(`\n🎉 RETURN IMPORT SUMMARY for ${path.basename(csvPath)}:`);
  console.log(`- New RTO/Return Entries Saved to DB: ${addedCount}`);
  console.log(`- Already Existing Return Entries Skipped: ${skippedCount}`);
}

importCsvReturns().then(() => process.exit(0)).catch(err => {
  console.error('Error importing CSV returns:', err);
  process.exit(1);
});
