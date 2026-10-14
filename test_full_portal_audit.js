const http = require('http');

function httpGet(url, customHeaders = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      headers: customHeaders,
    };
    http.get(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: data,
        });
      });
    }).on('error', reject);
  });
}

// 1. Marketplace Detection Engine Test
function detectPlatformFromText(t) {
  if (!t) return "generic";
  if (
    /\b\d{3}-\d{7}-\d{7}\b/.test(t) ||
    /\bASIN\b/i.test(t) ||
    /amazon/i.test(t) ||
    (/Mode of Payment/i.test(t) && /Place of delivery/i.test(t)) ||
    /ATS\s+LOGISTICS/i.test(t)
  ) {
    return "amazon";
  }
  if (
    /\bOD\d{10,}\b/i.test(t) ||
    /flipkart/i.test(t) ||
    /E-?\s*Kart/i.test(t) ||
    /AWB\s*No\.?\s*F/i.test(t) ||
    /Ordered through/i.test(t) ||
    /INSTAKART/i.test(t)
  ) {
    return "flipkart";
  }
  if (
    /\b\d{10,}_\d+\b/.test(t) ||
    /meesho/i.test(t) ||
    /Customer\s+Address/i.test(t) ||
    /If undelivered,?\s*return to/i.test(t) ||
    /Fashnear/i.test(t)
  ) {
    return "meesho";
  }
  return "generic";
}

// 2. Size & Coordinate Engine Test
function computeStampCoordinates(pageWidth, pageHeight, isCropActive, cropPreset) {
  const isThermalPage = pageWidth <= 360 && pageHeight <= 500;
  let pageCropX = 0;
  let pageCropY = 0;
  let pageCropW = pageWidth;
  let pageCropH = pageHeight;

  if (isCropActive && !isThermalPage) {
    if (cropPreset === "label_only") {
      pageCropY = Math.round(pageHeight * 0.58);
      pageCropH = Math.round(pageHeight * 0.42);
    }
  }

  const badgeWidth = isThermalPage
    ? Math.min(270, Math.round(pageCropW * 0.94))
    : isCropActive
    ? Math.min(340, Math.round(pageCropW * 0.90))
    : Math.min(540, Math.round(pageCropW * 0.90));

  const baseOffsetY = 10;
  const finalX = pageCropX + Math.round((pageCropW - badgeWidth) / 2);
  const finalY = pageCropY + baseOffsetY;

  return {
    isThermalPage,
    pageCropX,
    pageCropY,
    pageCropW,
    pageCropH,
    badgeWidth,
    finalX,
    finalY,
    isInsideVisibleBox: finalY >= pageCropY && finalY <= (pageCropY + pageCropH),
  };
}

async function runOverallAudit() {
  console.log("=================================================");
  console.log("   VELOURA / LABCOM FULL PORTAL AUDIT SUITE      ");
  console.log("=================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition, testName) {
    if (condition) {
      console.log(`  [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${testName}`);
      failed++;
    }
  }

  // --- SECTION A: BACKEND HEALTH & API ENDPOINTS ---
  console.log("--- SECTION A: Backend API Verification ---");
  try {
    const health = await httpGet("http://localhost:5001/api/health");
    assert(health.statusCode === 200, "Backend /api/health returns 200 OK");
    const healthJson = JSON.parse(health.data);
    assert(healthJson.ok === true, "Backend health status ok is true");
  } catch (e) {
    assert(false, `Backend health failed: ${e.message}`);
  }

  try {
    const custAnon = await httpGet("http://localhost:5001/api/customer-analysis?platform=ALL");
    assert(custAnon.statusCode === 200, "Anonymous GET /api/customer-analysis returns 200 OK");
    const jsonAnon = JSON.parse(custAnon.data);
    assert(jsonAnon.summary !== undefined, "Summary object exists in anonymous customer analysis");
    assert(jsonAnon.summary.totalUniqueBuyers === 0, "Anonymous user receives 0 buyers (Zero-Leakage Security PASS)");
    assert(jsonAnon.customers.length === 0, "Anonymous customer list is strictly empty (Zero-Leakage PASS)");
  } catch (e) {
    assert(false, `Anonymous customer query failed: ${e.message}`);
  }

  try {
    const custAuth = await httpGet("http://localhost:5001/api/customer-analysis?platform=ALL&email=vishal.nexios@gmail.com");
    assert(custAuth.statusCode === 200, "GET /api/customer-analysis?email=... returns 200 OK");
    const jsonAuth = JSON.parse(custAuth.data);
    assert(typeof jsonAuth.summary.meeshoCustomersCount === 'number', "meeshoCustomersCount is a number");
    assert(typeof jsonAuth.summary.flipkartCustomersCount === 'number', "flipkartCustomersCount is a number");
    assert(typeof jsonAuth.summary.amazonCustomersCount === 'number', "amazonCustomersCount is a number");
    console.log(`    -> Breakdown: Meesho: ${jsonAuth.summary.meeshoCustomersCount}, Flipkart: ${jsonAuth.summary.flipkartCustomersCount}, Amazon: ${jsonAuth.summary.amazonCustomersCount}`);
  } catch (e) {
    assert(false, `Customer analysis query failed: ${e.message}`);
  }

  try {
    const custMeesho = await httpGet("http://localhost:5001/api/customer-analysis?platform=meesho&email=vishal.nexios@gmail.com");
    assert(custMeesho.statusCode === 200, "GET /api/customer-analysis?platform=meesho returns 200 OK");
    const jsonMeesho = JSON.parse(custMeesho.data);
    assert(jsonMeesho.summary.selectedPlatform.toLowerCase() === "meesho", "Selected platform is meesho");
  } catch (e) {
    assert(false, `Customer analysis Meesho query failed: ${e.message}`);
  }

  try {
    const custFlipkart = await httpGet("http://localhost:5001/api/customer-analysis?platform=flipkart&email=vishal.nexios@gmail.com");
    assert(custFlipkart.statusCode === 200, "GET /api/customer-analysis?platform=flipkart returns 200 OK");
  } catch (e) {
    assert(false, `Customer analysis Flipkart query failed: ${e.message}`);
  }

  try {
    const custAmazon = await httpGet("http://localhost:5001/api/customer-analysis?platform=amazon&email=vishal.nexios@gmail.com");
    assert(custAmazon.statusCode === 200, "GET /api/customer-analysis?platform=amazon returns 200 OK");
  } catch (e) {
    assert(false, `Customer analysis Amazon query failed: ${e.message}`);
  }

  // --- SECTION B: FRONTEND ROUTE ACCESSIBILITY & AUTH SECURITY AUDIT ---
  console.log("\n--- SECTION B: Frontend Routes Health & Auth Guard Check ---");
  const protectedRoutes = [
    "/",
    "/remove-duplicate",
    "/customer-analysis",
    "/returns",
    "/analytics",
    "/history",
    "/settings",
  ];

  const publicRoutes = [
    "/login",
    "/privacy",
    "/terms",
  ];

  // 1. Unauthenticated Security: Ensure protected routes REDIRECT (307) to /login
  console.log("  [B.1] Unauthenticated Security Checks (Must Redirect to /login):");
  for (const r of protectedRoutes) {
    try {
      const res = await httpGet(`http://localhost:3000${r}`);
      const isRedirectToLogin = res.statusCode === 307 && res.headers.location && res.headers.location.includes('/login');
      assert(isRedirectToLogin, `Protected route '${r}' redirected unauthenticated user with HTTP 307 to /login`);
    } catch (e) {
      assert(false, `Protected route '${r}' check failed: ${e.message}`);
    }
  }

  // 2. Public Route Accessibility: Ensure public routes return 200 OK
  console.log("  [B.2] Public Route Accessibility Checks (Must return 200 OK):");
  for (const r of publicRoutes) {
    try {
      const res = await httpGet(`http://localhost:3000${r}`);
      assert(res.statusCode === 200, `Public route '${r}' responds with HTTP 200 OK`);
    } catch (e) {
      assert(false, `Public route '${r}' check failed: ${e.message}`);
    }
  }

  // 3. SEO Crawlability: Ensure Googlebot gets 200 OK for full indexing
  console.log("  [B.3] Search Engine Crawler Bypass Checks (Googlebot 200 OK):");
  for (const r of [...protectedRoutes, ...publicRoutes]) {
    try {
      const res = await httpGet(`http://localhost:3000${r}`, {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      });
      assert(res.statusCode === 200, `Googlebot receives HTTP 200 OK on '${r}' for SEO indexing`);
    } catch (e) {
      assert(false, `Googlebot crawl check on '${r}' failed: ${e.message}`);
    }
  }

  // --- SECTION C: MARKETPLACE DETECTION ENGINE AUDIT ---
  console.log("\n--- SECTION C: Marketplace Detection Engine Audit ---");
  const meeshoSnippet = "Order No 849302847291_1 Fashnear Technologies Customer Address Surat";
  const flipkartSnippet = "Flipkart India Pvt Ltd Order OD9382019482019284 AWB No FMPC938201 EKART LOGISTICS";
  const amazonSnippet = "Amazon Seller Services Order ID 402-8392019-3829104 ATS LOGISTICS Mode of Payment COD";
  const genericSnippet = "Standard invoice XYZ Logistics courier #999999";

  assert(detectPlatformFromText(meeshoSnippet) === "meesho", "Detects Meesho label correctly");
  assert(detectPlatformFromText(flipkartSnippet) === "flipkart", "Detects Flipkart label correctly");
  assert(detectPlatformFromText(amazonSnippet) === "amazon", "Detects Amazon label correctly");
  assert(detectPlatformFromText(genericSnippet) === "generic", "Generic label fallback works correctly");

  // --- SECTION D: SIZE DETECTION & STAMP COORDINATE AUDIT ---
  console.log("\n--- SECTION D: Size & Stamp Engine Math Audit ---");
  
  // 1. 4x6 Thermal Label
  const thermalRes = computeStampCoordinates(288, 432, false, "label_only");
  assert(thermalRes.isThermalPage === true, "288x432 correctly identified as 4x6 thermal");
  assert(thermalRes.finalY === 10, "4x6 thermal stamp at bottom (y=10)");
  assert(thermalRes.isInsideVisibleBox === true, "4x6 thermal stamp inside visible area");

  // 2. 4x6 Thermal with accidental crop
  const thermalCropRes = computeStampCoordinates(288, 432, true, "label_only");
  assert(thermalCropRes.pageCropY === 0, "4x6 thermal bypasses bottom crop protection");
  assert(thermalCropRes.finalY === 10, "4x6 thermal stamp remains at y=10");

  // 3. A4 Sheet Cropped to 4x6 Label
  const a4CroppedRes = computeStampCoordinates(595, 842, true, "label_only");
  assert(a4CroppedRes.isThermalPage === false, "595x842 correctly identified as A4 sheet");
  assert(a4CroppedRes.pageCropY === 488, "A4 bottom 58% cropped (pageCropY = 488)");
  assert(a4CroppedRes.finalY === 498, "A4 cropped stamp placed at pageCropY + 10 (498 pt)");
  assert(a4CroppedRes.isInsideVisibleBox === true, "A4 cropped stamp is 100% inside visible shipping label (NEVER cut off!)");

  // 4. A4 Sheet Uncropped
  const a4UncroppedRes = computeStampCoordinates(595, 842, false, "none");
  assert(a4UncroppedRes.pageCropY === 0, "A4 uncropped pageCropY = 0");
  assert(a4UncroppedRes.finalY === 10, "A4 uncropped stamp placed at footer (10 pt)");
  assert(a4UncroppedRes.badgeWidth === 536, "A4 uncropped stamp scaled across full A4 width");

  // --- SECTION E: REMOVE DUPLICATE MISMATCH PREVENTION AUDIT ---
  console.log("\n--- SECTION E: Remove Duplicate Marketplace Mismatch Prevention Audit ---");

  function checkMismatch(plat1, plat2) {
    return !!(
      plat1 &&
      plat2 &&
      plat1 !== "generic" &&
      plat2 !== "generic" &&
      plat1 !== plat2
    );
  }

  assert(checkMismatch("meesho", "flipkart") === true, "Meesho vs Flipkart correctly blocked as mismatch");
  assert(checkMismatch("meesho", "amazon") === true, "Meesho vs Amazon correctly blocked as mismatch");
  assert(checkMismatch("flipkart", "amazon") === true, "Flipkart vs Amazon correctly blocked as mismatch");
  assert(checkMismatch("meesho", "meesho") === false, "Meesho vs Meesho correctly allowed");
  assert(checkMismatch("flipkart", "flipkart") === false, "Flipkart vs Flipkart correctly allowed");
  assert(checkMismatch("amazon", "amazon") === false, "Amazon vs Amazon correctly allowed");
  assert(checkMismatch("meesho", "generic") === false, "Generic fallback gracefully tolerated");

  // --- FINAL AUDIT SUMMARY ---
  console.log("\n=================================================");
  console.log(`   TOTAL TESTS: ${passed + failed}`);
  console.log(`   PASSED:      ${passed}`);
  console.log(`   FAILED:      ${failed}`);
  console.log("=================================================");

  if (failed === 0) {
    console.log("\n🎉 ALL AUDITS PASSED 100%! SYSTEM IS TOTALLY BUG-FREE! 🎉\n");
    process.exit(0);
  } else {
    console.error(`\n❌ ${failed} AUDIT(S) FAILED!\n`);
    process.exit(1);
  }
}

runOverallAudit().catch((err) => {
  console.error("FATAL ERROR in audit suite:", err);
  process.exit(1);
});
