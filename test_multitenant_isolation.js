const http = require("http");
const { getDb } = require("./db");
const { ObjectId } = require("mongodb");

function httpRequest(url, options = {}, bodyData = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: options.method || "GET",
      headers: options.headers || {},
    };

    const req = http.request(reqOptions, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {
          json = null;
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data,
          json,
        });
      });
    });

    req.on("error", reject);
    if (bodyData) {
      req.write(typeof bodyData === "string" ? bodyData : JSON.stringify(bodyData));
    }
    req.end();
  });
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

async function runMultiTenantAudit() {
  console.log("=================================================");
  console.log("   STRICT MULTI-TENANT ISOLATION SECURITY AUDIT   ");
  console.log("=================================================\n");

  const tenantAlpha = "tenant_alpha_test@veloura.io";
  const tenantBeta = "tenant_beta_test@veloura.io";
  const baseUrl = "http://localhost:5001";
  const db = await getDb();

  async function cleanupTestData() {
    await db.collection("user_settings").deleteMany({ email: { $in: [tenantAlpha, tenantBeta] } });
    await db.collection("templates").deleteMany({ email: { $in: [tenantAlpha, tenantBeta] } });
    await db.collection("customers").deleteMany({ userEmail: { $in: [tenantAlpha, tenantBeta] } });
    await db.collection("customer_orders").deleteMany({ userEmail: { $in: [tenantAlpha, tenantBeta] } });
    await db.collection("return_entries").deleteMany({ userEmail: { $in: [tenantAlpha, tenantBeta] } });
    await db.collection("returns").deleteMany({ userEmail: { $in: [tenantAlpha, tenantBeta] } });
    await db.collection("qr_scans").deleteMany({ sellerEmail: { $in: [tenantAlpha, tenantBeta] } });
    await db.collection("batch_history").deleteMany({ email: { $in: [tenantAlpha, tenantBeta] } });
    await db.collection("contact_inquiries").deleteMany({ email: { $in: [tenantAlpha, tenantBeta] } });
  }

  await cleanupTestData();

  try {
    // -------------------------------------------------------------------------
    // TEST 1: User Settings Isolation
    // -------------------------------------------------------------------------
    console.log("--- TEST 1: User Settings Multi-Tenant Isolation ---");
    // Anonymous must receive 401
    const anonSettings = await httpRequest(`${baseUrl}/api/user/settings`);
    assert(anonSettings.statusCode === 401, "Anonymous GET /api/user/settings is blocked with 401 Unauthorized");

    // Tenant Alpha saves custom settings
    const alphaSaveRes = await httpRequest(
      `${baseUrl}/api/user/settings`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-email": tenantAlpha,
        },
      },
      {
        storeName: "Alpha Exclusive Boutique",
        phone: "+919876543210",
        waReceiverNumber: "919876543210",
        waApiKey: "alpha_super_secret_api_key_xyz",
      }
    );
    assert(alphaSaveRes.statusCode === 200, "Tenant Alpha successfully saves user settings");

    // Tenant Beta queries settings
    const betaSettings = await httpRequest(`${baseUrl}/api/user/settings`, {
      headers: { "x-user-email": tenantBeta },
    });
    assert(betaSettings.statusCode === 200, "Tenant Beta queries their own settings successfully");
    assert(
      !betaSettings.json.settings || betaSettings.json.settings.storeName !== "Alpha Exclusive Boutique",
      "Tenant Beta NEVER sees Tenant Alpha's storeName"
    );
    assert(
      !betaSettings.json.settings || !betaSettings.json.settings.waApiKey,
      "Tenant Beta NEVER sees Tenant Alpha's WhatsApp API Key"
    );

    // -------------------------------------------------------------------------
    // TEST 2: Templates Multi-Tenant Isolation & Delete Protection
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 2: Templates Multi-Tenant Isolation & IDOR Protection ---");
    // Anonymous must receive 401
    const anonTemplates = await httpRequest(`${baseUrl}/api/templates`);
    assert(anonTemplates.statusCode === 401, "Anonymous GET /api/templates is blocked with 401 Unauthorized");

    // Tenant Alpha creates custom template
    const alphaTemplateRes = await httpRequest(
      `${baseUrl}/api/templates`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-email": tenantAlpha,
        },
      },
      {
        name: "Alpha Confidential Template #99",
        description: "Strictly for Alpha eyes only",
        enableQr: true,
        qrText: "https://alpha.example.com/promo",
      }
    );
    assert(alphaTemplateRes.statusCode === 200, "Tenant Alpha creates custom template");
    const alphaTemplateId = alphaTemplateRes.json.id;

    // Tenant Beta queries templates
    const betaTemplates = await httpRequest(`${baseUrl}/api/templates`, {
      headers: { "x-user-email": tenantBeta },
    });
    assert(betaTemplates.statusCode === 200, "Tenant Beta queries templates successfully");
    const betaSeesAlphaTemplate = (betaTemplates.json.templates || []).some(
      (t) => t.name === "Alpha Confidential Template #99"
    );
    assert(!betaSeesAlphaTemplate, "Tenant Beta NEVER sees Tenant Alpha's private templates");

    // Tenant Beta attempts IDOR delete on Alpha's template
    const betaDeleteRes = await httpRequest(
      `${baseUrl}/api/templates?id=${alphaTemplateId}`,
      {
        method: "DELETE",
        headers: { "x-user-email": tenantBeta },
      }
    );
    // Alpha's template must NOT have been deleted
    const alphaCheck = await db.collection("templates").findOne({ _id: new ObjectId(alphaTemplateId) });
    assert(alphaCheck !== null, "IDOR Prevention: Tenant Beta CANNOT delete Tenant Alpha's template");

    // -------------------------------------------------------------------------
    // TEST 3: Customers & Customer Analysis Isolation
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 3: Customer Analysis Zero-Leakage Audit ---");
    // Seed 2 customers for Alpha
    const custInsert = await db.collection("customers").insertMany([
      {
        userEmail: tenantAlpha,
        name: "Ramesh Sharma",
        phone: "9988776655",
        city: "Surat",
        state: "Gujarat",
        district: "Surat",
        pincode: "395006",
        orderCount: 5,
        totalSpent: 4500,
        platforms: ["meesho"],
        orders: [
          {
            orderNo: "OD-ALPHA-001",
            sku: "ALPHA-VIP-DRESS",
            qty: 1,
            platform: "meesho",
          },
        ],
        lastOrderDate: new Date(),
      },
      {
        userEmail: tenantAlpha,
        name: "Pooja Patel",
        phone: "9988776656",
        city: "Ahmedabad",
        state: "Gujarat",
        district: "Ahmedabad",
        pincode: "380001",
        orderCount: 2,
        totalSpent: 1800,
        platforms: ["flipkart"],
        orders: [
          {
            orderNo: "OD-ALPHA-002",
            sku: "ALPHA-COTTON-SAREE",
            qty: 1,
            platform: "flipkart",
          },
        ],
        lastOrderDate: new Date(),
      },
    ]);
    const alphaCustomerId = String(custInsert.insertedIds[0]);

    // 1. Anonymous request must return 0 buyers
    const anonCust = await httpRequest(`${baseUrl}/api/customer-analysis`);
    assert(anonCust.statusCode === 200, "Anonymous GET /api/customer-analysis responds 200");
    assert(anonCust.json.summary.totalUniqueBuyers === 0, "Zero-Leakage: Anonymous buyer count is strictly 0");
    assert(anonCust.json.customers.length === 0, "Zero-Leakage: Anonymous customer list is strictly empty");

    // 2. Tenant Beta request must return 0 buyers (Zero leak from Alpha)
    const betaCust = await httpRequest(`${baseUrl}/api/customer-analysis`, {
      headers: { "x-user-email": tenantBeta },
    });
    assert(betaCust.statusCode === 200, "Tenant Beta queries /api/customer-analysis responds 200");
    assert(betaCust.json.summary.totalUniqueBuyers === 0, "Zero-Leakage: Tenant Beta buyer count is strictly 0");
    assert(betaCust.json.customers.length === 0, "Zero-Leakage: Tenant Beta sees 0 of Tenant Alpha's customers");

    // 3. Tenant Alpha queries and sees their 2 customers
    const alphaCust = await httpRequest(`${baseUrl}/api/customer-analysis`, {
      headers: { "x-user-email": tenantAlpha },
    });
    assert(alphaCust.json.summary.totalUniqueBuyers === 2, "Tenant Alpha accurately sees their own 2 customers");

    // 4. Customer Analysis History Zero-Leakage & Auth Guard
    const anonHistory = await httpRequest(`${baseUrl}/api/customer-analysis/history?id=${alphaCustomerId}`);
    assert(
      anonHistory.statusCode === 401,
      "Zero-Leakage: Anonymous customer history lookup blocked with 401 Unauthorized"
    );

    const betaHistory = await httpRequest(
      `${baseUrl}/api/customer-analysis/history?id=${alphaCustomerId}`,
      { headers: { "x-user-email": tenantBeta } }
    );
    assert(
      betaHistory.statusCode === 404,
      "Zero-Leakage: Tenant Beta cannot lookup Tenant Alpha customer (returns 404 Not Found)"
    );

    const alphaHistory = await httpRequest(
      `${baseUrl}/api/customer-analysis/history?id=${alphaCustomerId}`,
      { headers: { "x-user-email": tenantAlpha } }
    );
    assert(
      alphaHistory.statusCode === 200 && alphaHistory.json.name === "Ramesh Sharma",
      "Tenant Alpha successfully looks up their own customer history"
    );

    // -------------------------------------------------------------------------
    // TEST 4: Insights Dashboard Multi-Tenant Isolation
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 4: Insights Dashboard Multi-Tenant Isolation ---");
    const anonInsights = await httpRequest(`${baseUrl}/api/insights/dashboard`);
    assert(
      anonInsights.json.totalOrders === 0 && anonInsights.json.totalReturns === 0,
      "Zero-Leakage: Anonymous insights dashboard returns 0 orders and 0 returns"
    );

    const betaInsights = await httpRequest(`${baseUrl}/api/insights/dashboard`, {
      headers: { "x-user-email": tenantBeta },
    });
    assert(
      betaInsights.json.totalOrders === 0 && betaInsights.json.totalReturns === 0,
      "Zero-Leakage: Tenant Beta insights dashboard returns 0 orders and 0 returns"
    );

    const alphaInsights = await httpRequest(`${baseUrl}/api/insights/dashboard`, {
      headers: { "x-user-email": tenantAlpha },
    });
    assert(
      alphaInsights.json.totalOrders >= 2,
      "Tenant Alpha insights dashboard accurately displays Alpha's orders"
    );

    // -------------------------------------------------------------------------
    // TEST 5: Returns Multi-Tenant Isolation & IDOR Protection
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 5: Returns Multi-Tenant Isolation & IDOR Protection ---");
    // Seed 1 return for Alpha
    const alphaReturnInsert = await db.collection("returns").insertOne({
      userEmail: tenantAlpha,
      orderNo: "OD-ALPHA-RET-999",
      subOrderNo: "SUB-ALPHA-RET-999",
      sku: "ALPHA-VIP-SKU",
      returnType: "RTO",
      status: "VERIFIED",
      createdAt: new Date(),
    });
    const alphaReturnId = String(alphaReturnInsert.insertedId);

    // 1. Anonymous GET returns
    const anonReturns = await httpRequest(`${baseUrl}/api/returns`);
    assert(anonReturns.json.returns.length === 0, "Zero-Leakage: Anonymous returns list is strictly empty");
    assert(anonReturns.json.summary.totalReturns === 0, "Zero-Leakage: Anonymous totalReturns count is 0");

    // 2. Beta GET returns
    const betaReturns = await httpRequest(`${baseUrl}/api/returns`, {
      headers: { "x-user-email": tenantBeta },
    });
    assert(betaReturns.json.returns.length === 0, "Zero-Leakage: Tenant Beta sees 0 returns of Tenant Alpha");

    // 3. Alpha GET returns
    const alphaReturns = await httpRequest(`${baseUrl}/api/returns`, {
      headers: { "x-user-email": tenantAlpha },
    });
    assert(alphaReturns.json.returns.length === 1, "Tenant Alpha accurately sees their own return record");

    // 4. Beta attempts IDOR DELETE on Alpha's return
    const betaDeleteReturn = await httpRequest(
      `${baseUrl}/api/returns?id=${alphaReturnId}`,
      {
        method: "DELETE",
        headers: { "x-user-email": tenantBeta },
      }
    );
    const alphaReturnAfterBetaDelete = await db.collection("returns").findOne({ _id: new ObjectId(alphaReturnId) });
    assert(alphaReturnAfterBetaDelete !== null, "IDOR Protection: Tenant Beta CANNOT delete Tenant Alpha's return record");

    // 5. Anonymous DELETE attempt
    const anonDeleteReturn = await httpRequest(
      `${baseUrl}/api/returns?id=${alphaReturnId}`,
      { method: "DELETE" }
    );
    assert(anonDeleteReturn.statusCode === 401, "Anonymous DELETE /api/returns is blocked with 401 Unauthorized");

    // -------------------------------------------------------------------------
    // TEST 6: Analytics & Contact Inquiries Isolation
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 6: Analytics & Contact Inquiries Isolation ---");
    // Anonymous GET /api/analytics
    const anonAnalytics = await httpRequest(`${baseUrl}/api/analytics`);
    assert(anonAnalytics.statusCode === 401, "Anonymous GET /api/analytics is blocked with 401 Unauthorized");

    // Seed QR scan for Alpha
    await db.collection("qr_scans").insertOne({
      sellerEmail: tenantAlpha,
      orderNo: "OD-ALPHA-001",
      sku: "ALPHA-SKU",
      date: new Date().toISOString().split("T")[0],
      createdAt: new Date(),
    });

    // Beta queries analytics
    const betaAnalytics = await httpRequest(`${baseUrl}/api/analytics`, {
      headers: { "x-user-email": tenantBeta },
    });
    assert(betaAnalytics.json.totalScans === 0, "Zero-Leakage: Tenant Beta sees 0 scans (Alpha scans isolated)");

    // Alpha queries analytics
    const alphaAnalytics = await httpRequest(`${baseUrl}/api/analytics`, {
      headers: { "x-user-email": tenantAlpha },
    });
    assert(alphaAnalytics.json.totalScans === 1, "Tenant Alpha sees their 1 scan");

    // Anonymous GET /api/contact
    const anonContact = await httpRequest(`${baseUrl}/api/contact`);
    assert(anonContact.statusCode === 401, "Anonymous GET /api/contact is blocked with 401 Unauthorized");

    // Seed Contact Inquiry for Alpha
    await db.collection("contact_inquiries").insertOne({
      email: tenantAlpha,
      name: "Alpha Support Rep",
      phone: "919999999999",
      message: "Urgent enterprise onboarding question",
      createdAt: new Date(),
    });

    // Beta queries contact inquiries
    const betaContact = await httpRequest(`${baseUrl}/api/contact`, {
      headers: { "x-user-email": tenantBeta },
    });
    assert(
      betaContact.json.inquiries.length === 0,
      "Zero-Leakage: Tenant Beta CANNOT see Tenant Alpha's contact inquiries"
    );

    // Alpha queries contact inquiries
    const alphaContact = await httpRequest(`${baseUrl}/api/contact`, {
      headers: { "x-user-email": tenantAlpha },
    });
    assert(
      alphaContact.json.inquiries.length === 1,
      "Tenant Alpha successfully sees their own contact inquiry"
    );

    // -------------------------------------------------------------------------
    // SUMMARY
    // -------------------------------------------------------------------------
    console.log("\n=================================================");
    console.log(`   TOTAL ISOLATION TESTS: ${passed + failed}`);
    console.log(`   PASSED:                 ${passed}`);
    console.log(`   FAILED:                 ${failed}`);
    console.log("=================================================");

    if (failed === 0) {
      console.log("\n🎉 MULTI-TENANT ISOLATION AUDIT: 100% BULLETPROOF ZERO-LEAKAGE PASS! 🎉\n");
      process.exit(0);
    } else {
      console.error(`\n❌ ${failed} ISOLATION AUDIT(S) FAILED!\n`);
      process.exit(1);
    }
  } finally {
    await cleanupTestData();
  }
}

runMultiTenantAudit().catch((err) => {
  console.error("Fatal error in multi-tenant audit:", err);
  process.exit(1);
});
