/**
 * Indian State & Language Detection with Heartwarming Regional Thank You Greetings
 * Specifically isolates the Customer Delivery Address block to avoid false positives
 * from the seller/warehouse return address.
 */

const STATE_MESSAGES = {
  TamilNadu: {
    language: "Tamil",
    message: "Nandri! Ungal anbirku manamarndha nandri!",
  },
  Gujarat: {
    language: "Gujarati",
    message: "Aabhar! Tamara prem ane order badal khub khub aabhar!",
  },
  Punjab: {
    language: "Punjabi",
    message: "Dhanvaad ji! Tuhade vishwas aur order layi bahut dhanvaad!",
  },
  Maharashtra: {
    language: "Marathi",
    message: "Dhanyavaad! Aplya vishvasabaddal manapasun aabhar!",
  },
  Karnataka: {
    language: "Kannada",
    message: "Dhanyavadagalu! Nimma preeti mathu order ge dhanyavadagalu!",
  },
  Kerala: {
    language: "Malayalam",
    message: "Nandi! Ningalude snehatthinu nandi!",
  },
  Telangana: {
    language: "Telugu",
    message: "Dhanyavadalu! Mee premaku hrudayapoorvaka dhanyavadalu!",
  },
  AndhraPradesh: {
    language: "Telugu",
    message: "Dhanyavadalu! Mee premaku hrudayapoorvaka dhanyavadalu!",
  },
  WestBengal: {
    language: "Bengali",
    message: "Dhonnobad! Apnar bhalobasha o biswaser jonno dhonnobad!",
  },
  Odisha: {
    language: "Odia",
    message: "Dhanyabad! Apananka bishwas o order pain ashesha dhanyabad!",
  },
  Assam: {
    language: "Assamese",
    message: "Dhonyobad! Aponar morom aru orderor babe dhonyobad!",
  },
  Rajasthan: {
    language: "Hindi",
    message: "Aapke pyaar aur vishwas ke liye ghani khamma aur shukriya!",
  },
  HindiBelt: {
    language: "Hindi",
    message: "Thank you! Aapke pyaar aur vishwas ke liye bahut-bahut shukriya!",
  },
};

/**
 * Isolates the Customer Delivery Address block from the label text.
 */
function extractCustomerAddress(rawText = "") {
  // Try extracting between "Customer Address" and "If undelivered, return to" / "Product Details"
  const m = rawText.match(/Customer Address\s*[:\s]*([\s\S]*?)(?:If undelivered|return to|Sold by|Product Details|TAX INVOICE|BILL TO|Shipping Address)/i);
  if (m && m[1].trim().length > 10) {
    return m[1].trim();
  }
  // Fallback: top 40% of page text
  return rawText.slice(0, Math.floor(rawText.length * 0.45));
}

/**
 * Resolves State and Regional Greeting strictly from Customer Delivery Address
 */
function resolveRegionalGreeting(rawText = "") {
  const custAddress = extractCustomerAddress(rawText);
  const text = custAddress.toUpperCase();

  // 1. Check Specific State Names in Customer Delivery Address
  if (/TAMIL\s*NADU|TAMILNADU|CHENNAI|COIMBATORE|MADURAI|TIRUCHIRAPPALLI|SALEM|TIRUPPUR|THIRUVALLUR|VELLORE|ERODE|TIRUNELVELI|KANCHEEPURAM|DINDIGUL|THANJAVUR|TUTICORIN|CUDDALORE/i.test(text)) {
    return { state: "Tamil Nadu", ...STATE_MESSAGES.TamilNadu };
  }
  if (/PUNJAB|LUDHIANA|AMRITSAR|JALANDHAR|PATIALA|BATHINDA|MOHALI|HOSHIARPUR|BATALA|PATHANKOT/i.test(text)) {
    return { state: "Punjab", ...STATE_MESSAGES.Punjab };
  }
  if (/MAHARASHTRA|MUMBAI|PUNE|NAGPUR|THANE|NASHIK|AURANGABAD|SOLAPUR|AMRAVATI|KOLHAPUR|NAVI MUMBAI|AKOLA|LATUR|DHULE/i.test(text)) {
    return { state: "Maharashtra", ...STATE_MESSAGES.Maharashtra };
  }
  if (/KARNATAKA|BENGALURU|BANGALORE|MYSURU|MYSORE|HUBLI|DHARWAD|MANGALORE|BELGAUM|GULBARGA|DAVANAGERE|BELLARY|SHIMOGA/i.test(text)) {
    return { state: "Karnataka", ...STATE_MESSAGES.Karnataka };
  }
  if (/KERALA|KOCHI|COCHIN|THIRUVANANTHAPURAM|TRIVANDRUM|KOZHIKODE|CALICUT|THRISSUR|KANNUR|KOLLAM|ALAPPUZHA|PALAKKAD|MALAPPURAM|KOTTAYAM/i.test(text)) {
    return { state: "Kerala", ...STATE_MESSAGES.Kerala };
  }
  if (/TELANGANA|HYDERABAD|SECUNDERABAD|WARANGAL|NIZAMABAD|KHAMMAM|KARIMNAGAR|RAMAGUNDAM/i.test(text)) {
    return { state: "Telangana", ...STATE_MESSAGES.Telangana };
  }
  if (/ANDHRA\s*PRADESH|ANDHRAPRADESH|VISAKHAPATNAM|VIZAG|VIJAYAWADA|GUNTUR|NELLORE|KURNOOL|RAJAHMUNDRY|TIRUPATI|KADAPA|KAKINADA/i.test(text)) {
    return { state: "Andhra Pradesh", ...STATE_MESSAGES.AndhraPradesh };
  }
  if (/WEST\s*BENGAL|BENGAL|WESTBENGAL|KOLKATA|CALCUTTA|HOWRAH|DURGAPUR|ASANSOL|SILIGURI|BARDHAMAN|MALDA|KHARAGPUR/i.test(text)) {
    return { state: "West Bengal", ...STATE_MESSAGES.WestBengal };
  }
  if (/ODISHA|ORISSA|BHUBANESWAR|CUTTACK|ROURKELA|BERHAMPUR|SAMBALPUR|PURI|BALASORE/i.test(text)) {
    return { state: "Odisha", ...STATE_MESSAGES.Odisha };
  }
  if (/ASSAM|GUWAHATI|SILCHAR|DIBRUGARH|JORHAT|NAGAON|TINSUKIA|TEZPUR/i.test(text)) {
    return { state: "Assam", ...STATE_MESSAGES.Assam };
  }
  if (/RAJASTHAN|JAIPUR|JODHPUR|KOTA|BIKANER|AJMER|UDAIPUR|BHILWARA|ALWAR|SIKAR|PALI/i.test(text)) {
    return { state: "Rajasthan", ...STATE_MESSAGES.Rajasthan };
  }
  if (/GUJARAT|AHMEDABAD|SURAT|VADODARA|RAJKOT|GANDHINAGAR|BHAVNAGAR|JAMNAGAR|JUNAGADH|ANAND|NAVSARI|MORBI|MEHSANA|BHARUCH/i.test(text)) {
    return { state: "Gujarat", ...STATE_MESSAGES.Gujarat };
  }

  // 2. PIN Code Detection strictly inside Customer Delivery Address
  const pinMatch = custAddress.match(/\b([1-8]\d{5})\b/);
  if (pinMatch) {
    const pin2 = parseInt(pinMatch[1].substring(0, 2), 10);
    if (pin2 >= 60 && pin2 <= 64) return { state: "Tamil Nadu", ...STATE_MESSAGES.TamilNadu };
    if (pin2 >= 14 && pin2 <= 16) return { state: "Punjab", ...STATE_MESSAGES.Punjab };
    if (pin2 >= 40 && pin2 <= 44) return { state: "Maharashtra", ...STATE_MESSAGES.Maharashtra };
    if (pin2 >= 56 && pin2 <= 59) return { state: "Karnataka", ...STATE_MESSAGES.Karnataka };
    if (pin2 >= 67 && pin2 <= 69) return { state: "Kerala", ...STATE_MESSAGES.Kerala };
    if (pin2 >= 50 && pin2 <= 53) return { state: "Telangana/AP", ...STATE_MESSAGES.Telangana };
    if (pin2 >= 70 && pin2 <= 74) return { state: "West Bengal", ...STATE_MESSAGES.WestBengal };
    if (pin2 >= 75 && pin2 <= 77) return { state: "Odisha", ...STATE_MESSAGES.Odisha };
    if (pin2 >= 78 && pin2 <= 79) return { state: "Assam", ...STATE_MESSAGES.Assam };
    if (pin2 >= 30 && pin2 <= 34) return { state: "Rajasthan", ...STATE_MESSAGES.Rajasthan };
    if (pin2 >= 36 && pin2 <= 39) return { state: "Gujarat", ...STATE_MESSAGES.Gujarat };
  }

  // 3. Default Hindi / Universal Indian Greeting (for UP, MP, Bihar, Delhi, etc.)
  return { state: "India", ...STATE_MESSAGES.HindiBelt };
}

module.exports = { resolveRegionalGreeting, STATE_MESSAGES };
