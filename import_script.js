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

async function importCsvOrders() {
  const csvPath = process.argv[2] || 'C:\\Users\\DREAMWORLD\\Downloads\\Orders_2026-09-01_2026-09-30_2026-10-08_16_30-16_35_4679897.csv';

  console.log('📦 Starting CSV Import Process...');
  console.log(`📄 Source File: ${csvPath}`);

  const db = await getDb();
  const customersCol = db.collection('customers');
  const ordersCol = db.collection('orders');

  // 1. Index existing orders
  console.log('🔍 Indexing existing database orders to ensure zero duplicate overwrites...');
  const existingOrderSet = new Set();

  const [existingOrders, existingCustomers] = await Promise.all([
    ordersCol.find({}, { projection: { orderNo: 1, subOrderNo: 1 } }).toArray(),
    customersCol.find({}, { projection: { orders: 1 } }).toArray()
  ]);

  existingOrders.forEach(o => {
    if (o.orderNo) existingOrderSet.add(String(o.orderNo).trim());
    if (o.subOrderNo) existingOrderSet.add(String(o.subOrderNo).trim());
  });

  existingCustomers.forEach(c => {
    if (Array.isArray(c.orders)) {
      c.orders.forEach(o => {
        if (o.orderNo) existingOrderSet.add(String(o.orderNo).trim());
        if (o.subOrderNo) existingOrderSet.add(String(o.subOrderNo).trim());
        if (o.subOrderId) existingOrderSet.add(String(o.subOrderId).trim());
      });
    }
  });

  console.log(`✅ Loaded ${existingOrderSet.size} existing order keys from database.`);

  // 2. Parse CSV
  const fileStream = fs.createReadStream(csvPath, { encoding: 'utf-8' });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let lineIndex = 0;
  let headers = [];
  let totalRowsCount = 0;
  let skippedAlreadyInsertedCount = 0;
  const itemsToInsert = [];
  const statusBreakdown = {};

  for await (const line of rl) {
    lineIndex++;
    if (!line.trim()) continue;

    const cleanedCols = parseCsvLine(line);

    if (lineIndex === 1) {
      headers = cleanedCols;
      continue;
    }

    totalRowsCount++;

    const statusReason = (cleanedCols[0] || 'EMPTY').trim().toUpperCase();
    statusBreakdown[statusReason] = (statusBreakdown[statusReason] || 0) + 1;

    const subOrderNo = (cleanedCols[1] || '').trim();
    if (!subOrderNo) continue;

    const orderNo = subOrderNo.split('_')[0].trim();
    const orderDate = (cleanedCols[3] || new Date().toISOString().slice(0, 10)).trim();
    const customerState = (cleanedCols[5] || 'India').trim();
    const sku = (cleanedCols[7] || '').trim();
    const qty = parseInt(cleanedCols[9] || '1', 10) || 1;

    // CHECK DEDUPLICATION STRICTLY
    if (existingOrderSet.has(subOrderNo) || existingOrderSet.has(orderNo)) {
      skippedAlreadyInsertedCount++;
      continue;
    }

    existingOrderSet.add(subOrderNo);
    existingOrderSet.add(orderNo);

    const custName = `Customer (${customerState})`;
    const address = `${customerState}, India`;

    itemsToInsert.push({
      custName,
      mobile: 'N/A',
      address,
      orderNo,
      subOrderNo,
      paymentType: 'COD',
      orderDate,
      sku,
      qty,
      state: customerState,
      custKey: `state:${customerState.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
    });
  }

  console.log(`\n📊 Analysis Summary for file: ${path.basename(csvPath)}`);
  console.log(`- Total Orders in CSV: ${totalRowsCount}`);
  console.log(`- Already Inserted in DB (Skipped & Preserved Untouched): ${skippedAlreadyInsertedCount}`);
  console.log(`- New Un-inserted Orders Ready for Add: ${itemsToInsert.length}`);
  console.log(`- Status Breakdown in CSV:`, statusBreakdown);

  if (itemsToInsert.length === 0) {
    console.log('✨ All orders in this CSV were already inserted in the DB. Nothing to add!');
    process.exit(0);
  }

  // 3. Batch Insert New Orders into DB
  console.log(`🚀 Inserting ${itemsToInsert.length} new orders into database...`);

  const orderOps = [];
  const stateCustomerMap = new Map();

  itemsToInsert.forEach(item => {
    orderOps.push({
      insertOne: {
        document: {
          orderNo: item.orderNo,
          subOrderNo: item.subOrderNo,
          paymentType: item.paymentType,
          customerName: item.custName,
          customerMobile: item.mobile,
          customerAddress: item.address,
          state: item.state,
          orderDate: item.orderDate,
          sku: item.sku,
          qty: item.qty,
          userEmail: 'csv_import',
          createdAt: new Date()
        }
      }
    });

    const stateKey = item.state.toLowerCase();
    if (!stateCustomerMap.has(stateKey)) {
      stateCustomerMap.set(stateKey, {
        name: item.custName,
        mobileNumber: 'N/A',
        address: item.address,
        state: item.state,
        district: 'Central',
        custKey: item.custKey,
        orders: [],
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }

    const custObj = stateCustomerMap.get(stateKey);
    custObj.orders.push({
      orderNo: item.orderNo,
      subOrderNo: item.subOrderNo,
      paymentType: item.paymentType,
      orderDate: item.orderDate,
      sku: item.sku,
      qty: item.qty,
      state: item.state,
      address: item.address,
      processedAt: new Date()
    });
  });

  if (orderOps.length > 0) {
    await ordersCol.bulkWrite(orderOps, { ordered: false });
  }

  for (const [stateKey, custData] of stateCustomerMap.entries()) {
    const existingCust = await customersCol.findOne({ custKey: custData.custKey });
    if (existingCust) {
      const mergedOrders = [...(existingCust.orders || [])];
      custData.orders.forEach(newO => {
        if (!mergedOrders.some(o => o.orderNo === newO.orderNo || o.subOrderNo === newO.subOrderNo)) {
          mergedOrders.push(newO);
        }
      });
      await customersCol.updateOne(
        { _id: existingCust._id },
        {
          $set: {
            orders: mergedOrders,
            orderCount: mergedOrders.length,
            updatedAt: new Date()
          }
        }
      );
    } else {
      await customersCol.insertOne({
        ...custData,
        orderCount: custData.orders.length
      });
    }
  }

  console.log(`\n🎉 SUCCESS! ${itemsToInsert.length} new orders inserted cleanly into DB.`);
  console.log(`🛡️ All ${skippedAlreadyInsertedCount} pre-existing orders were 100% preserved untouched.`);
  process.exit(0);
}

importCsvOrders().catch(err => {
  console.error('❌ Error during import:', err);
  process.exit(1);
});
