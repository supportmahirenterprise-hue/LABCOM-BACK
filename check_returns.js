const fs = require('fs');
const readline = require('readline');

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

async function analyze() {
  const csvPath = 'C:\\Users\\DREAMWORLD\\Downloads\\Orders_2026-08-01_2026-08-31_2026-10-08_15_36-15_41_4679897.csv';
  const rl = readline.createInterface({
    input: fs.createReadStream(csvPath),
    crlfDelay: Infinity
  });

  const statuses = {};
  let index = 0;
  const returnRows = [];

  for await (const line of rl) {
    index++;
    if (index === 1) continue;
    const cols = parseCsvLine(line);
    const reason = cols[0] || 'EMPTY';
    statuses[reason] = (statuses[reason] || 0) + 1;

    if (/return|rto|customer|cancelled|refund|reject/i.test(reason) || /return|rto|customer|cancelled|refund|reject/i.test(line)) {
      returnRows.push({ row: index, reason, subOrderNo: cols[1], sku: cols[7] });
    }
  }

  console.log('--- STATUS BREAKDOWN IN CSV ---');
  console.log(statuses);
  console.log(`Total Return/RTO matched rows: ${returnRows.length}`);
  if (returnRows.length > 0) {
    console.log('Sample Return Rows:', returnRows.slice(0, 5));
  }
}
analyze();
