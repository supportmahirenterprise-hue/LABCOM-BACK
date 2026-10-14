const http = require("http");
const { PDFDocument } = require("pdf-lib");

function httpRequest(url, options = {}, bodyData = null, isMultipart = false, boundary = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const headers = options.headers || {};
    if (isMultipart && boundary) {
      headers["Content-Type"] = `multipart/form-data; boundary=${boundary}`;
    } else if (bodyData && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }

    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: options.method || "GET",
      headers,
    };

    const req = http.request(reqOptions, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const buffer = Buffer.concat(chunks);
        const text = buffer.toString("utf-8");
        let json = null;
        try {
          json = JSON.parse(text);
        } catch (e) {
          json = null;
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: text,
          buffer,
          json,
        });
      });
    });

    req.on("error", reject);
    if (bodyData) {
      if (Buffer.isBuffer(bodyData)) {
        req.write(bodyData);
      } else if (typeof bodyData === "string") {
        req.write(bodyData);
      } else {
        req.write(JSON.stringify(bodyData));
      }
    }
    req.end();
  });
}

function buildMultipartBody(fields, fileField, fileName, fileBuffer, boundary) {
  const chunks = [];
  for (const [k, v] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  if (fileField && fileBuffer) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${fileName}"\r\nContent-Type: application/pdf\r\n\r\n`
      )
    );
    chunks.push(fileBuffer);
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  [PASS] ${message}`);
  } else {
    failed++;
    console.error(`  [FAIL] ${message}`);
  }
}

async function runEdgeCasesAndStressTests() {
  console.log("=================================================");
  console.log("   EDGE CASES, RESILIENCE & STRESS AUDIT SUITE   ");
  console.log("=================================================\n");

  const baseUrl = "http://localhost:5001";
  const testUser = "resilience_auditor@labelpro.in";

  // 1. Corrupt and Empty File Upload Handling
  console.log("--- 1. File Upload Defense & Malformed Input Handling ---");
  const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2);

  // 1.1 Zero-byte upload to /api/preview
  const emptyBody = buildMultipartBody({}, "pdf", "empty.pdf", Buffer.alloc(0), boundary);
  const emptyRes = await httpRequest(`${baseUrl}/api/preview`, { method: "POST" }, emptyBody, true, boundary);
  assert(emptyRes.statusCode === 400, "Empty PDF upload rejected with HTTP 400 Bad Request");
  assert(
    emptyRes.json && emptyRes.json.error && emptyRes.json.error.includes("empty"),
    "Clear descriptive error message returned for empty PDF"
  );

  // 1.2 Non-PDF file (text masquerading as pdf)
  const fakePdfBody = buildMultipartBody({}, "pdf", "fake.pdf", Buffer.from("THIS IS NOT A VALID PDF FILE CONTENT"), boundary);
  const fakeRes = await httpRequest(`${baseUrl}/api/preview`, { method: "POST" }, fakePdfBody, true, boundary);
  assert(fakeRes.statusCode === 400, "Non-PDF file rejected with HTTP 400 Bad Request");
  assert(
    fakeRes.json && fakeRes.json.error && fakeRes.json.error.includes("not a valid PDF"),
    "Rejects invalid PDF header with helpful error"
  );

  // 1.3 Valid minimal PDF with /api/preview
  const miniDoc = await PDFDocument.create();
  const page = miniDoc.addPage([288, 432]);
  page.drawText("Order No: 849302847291_1\nCustomer Address: Surat, Gujarat\nSKU: TEST-DRESS\nQty: 1");
  const miniPdfBytes = await miniDoc.save();
  const validBody = buildMultipartBody({ useNativeScript: "false" }, "pdf", "valid_label.pdf", Buffer.from(miniPdfBytes), boundary);
  const validRes = await httpRequest(
    `${baseUrl}/api/preview`,
    {
      method: "POST",
      headers: { "x-user-email": testUser },
    },
    validBody,
    true,
    boundary
  );
  assert(validRes.statusCode === 200, "Valid PDF parses and responds HTTP 200 OK");
  assert(validRes.json.pageCount === 1, "Accurately detects 1 page in PDF");
  assert(Array.isArray(validRes.json.duplicateOrderWarnings), "duplicateOrderWarnings is an array (No ReferenceError!)");
  assert(Array.isArray(validRes.json.returnWarnings), "returnWarnings is an array");

  // 2. Summary Generation Resilience
  console.log("\n--- 2. Batch Summary Generation Resilience ---");
  // 2.1 Empty array to /api/generate-summary
  const emptySumRes = await httpRequest(`${baseUrl}/api/generate-summary`, { method: "POST" }, { pages: [] });
  assert(emptySumRes.statusCode === 400, "Empty pages to /api/generate-summary rejected with HTTP 400");

  // 2.2 Valid page array to /api/generate-summary
  const validSumRes = await httpRequest(
    `${baseUrl}/api/generate-summary`,
    { method: "POST" },
    {
      pages: [
        { page: 1, orderNo: "OD-100", sku: "SKU-A", qty: 1 },
        { page: 2, orderNo: "OD-101", sku: "SKU-B", qty: 2 },
      ],
      fileName: "batch_orders.pdf",
    }
  );
  assert(validSumRes.statusCode === 200, "Valid pages generate summary PDF with HTTP 200 OK");
  assert(validSumRes.headers["content-type"] === "application/pdf", "Summary returns Content-Type application/pdf");
  assert(validSumRes.buffer.length > 500, "Summary PDF contains valid non-empty byte stream");

  // 3. Returns API Robustness & Validation
  console.log("\n--- 3. Returns Endpoint Security & Input Validation ---");
  // 3.1 Invalid ObjectId to DELETE /api/returns
  const invalidDeleteRes = await httpRequest(
    `${baseUrl}/api/returns?id=not_a_valid_id`,
    {
      method: "DELETE",
      headers: { "x-user-email": testUser },
    }
  );
  assert(invalidDeleteRes.statusCode === 400, "Invalid ObjectId to DELETE /api/returns rejected with HTTP 400");

  // 3.2 Non-existent ObjectId to DELETE /api/returns
  const nonExistentDeleteRes = await httpRequest(
    `${baseUrl}/api/returns?id=000000000000000000000000`,
    {
      method: "DELETE",
      headers: { "x-user-email": testUser },
    }
  );
  assert(nonExistentDeleteRes.statusCode === 404, "Non-existent return ID responds with HTTP 404 Not Found");

  // 4. WhatsApp Media Security & Validation
  console.log("\n--- 4. WhatsApp Dispatch Security & Validation ---");
  // 4.1 Missing receiver number
  const noNumWaRes = await httpRequest(
    `${baseUrl}/api/whatsapp/send-media`,
    {
      method: "POST",
      headers: { "x-user-email": testUser },
    },
    { fileData: "data:application/pdf;base64,JVBERi0xLjQ=" }
  );
  assert(noNumWaRes.statusCode === 400, "WhatsApp dispatch without receiver number rejected with HTTP 400");

  // 4.2 Invalid short receiver number
  const shortNumWaRes = await httpRequest(
    `${baseUrl}/api/whatsapp/send-media`,
    {
      method: "POST",
      headers: { "x-user-email": testUser },
    },
    { number: "12345", fileData: "data:application/pdf;base64,JVBERi0xLjQ=" }
  );
  assert(shortNumWaRes.statusCode === 400, "Invalid short phone number rejected with HTTP 400");

  // 5. Contact Inquiries Validation
  console.log("\n--- 5. Contact Inquiries Input Validation ---");
  // 5.1 Missing required fields
  const emptyContactRes = await httpRequest(`${baseUrl}/api/contact`, { method: "POST" }, { name: "Test" });
  assert(emptyContactRes.statusCode === 400, "Contact inquiry with missing fields rejected with HTTP 400");

  // 5.2 Valid contact submission
  const validContactRes = await httpRequest(
    `${baseUrl}/api/contact`,
    { method: "POST" },
    {
      name: "Automated Tester",
      email: "tester@labelpro.in",
      phone: "919876543210",
      message: "End to end stress audit inquiry verification",
    }
  );
  assert(validContactRes.statusCode === 201, "Valid contact inquiry accepted with HTTP 201 Created");
  assert(
    validContactRes.json && validContactRes.json.referenceId && validContactRes.json.referenceId.startsWith("LP-"),
    "Generates clean LP- reference ID for tracking"
  );

  // 6. Templates Input Validation
  console.log("\n--- 6. Templates Input Validation ---");
  // 6.1 Empty template name
  const emptyNameTpl = await httpRequest(
    `${baseUrl}/api/templates`,
    {
      method: "POST",
      headers: { "x-user-email": testUser },
    },
    { name: "   " }
  );
  assert(emptyNameTpl.statusCode === 400, "Empty template name rejected with HTTP 400");

  // 6.2 Invalid template ID format on delete
  const invalidTplDelete = await httpRequest(
    `${baseUrl}/api/templates?id=bad_id`,
    {
      method: "DELETE",
      headers: { "x-user-email": testUser },
    }
  );
  assert(invalidTplDelete.statusCode === 400, "Invalid Template ID rejected with HTTP 400");

  // SUMMARY
  console.log("\n=================================================");
  console.log(`   TOTAL TESTS: ${passed + failed}`);
  console.log(`   PASSED:      ${passed}`);
  console.log(`   FAILED:      ${failed}`);
  console.log("=================================================");

  if (failed === 0) {
    console.log("\n🎉 ALL EDGE CASES & RESILIENCE TESTS PASSED 100%! SYSTEM IS ROCK-SOLID! 🎉\n");
    process.exit(0);
  } else {
    console.error(`\n❌ ${failed} TEST(S) FAILED!\n`);
    process.exit(1);
  }
}

runEdgeCasesAndStressTests().catch((err) => {
  console.error("Fatal error in stress test suite:", err);
  process.exit(1);
});
