/**
 * Indian State & Language Detection with Heartwarming Regional Thank You Greetings
 * Specifically isolates the Customer Delivery Address block to avoid false positives
 * from the seller/warehouse return address.
 */

const STATE_MESSAGES = {
  TamilNadu: {
    language: "Tamil",
    message: "Nandri! Ungal anbirku manamarndha nandri!",
    nativeMessage: "நன்றி! உங்கள் அன்பிற்கு மனமார்ந்த நன்றி!",
  },
  Gujarat: {
    language: "Gujarati",
    message: "Aabhar! Tamara prem ane order badal khub khub aabhar!",
    nativeMessage: "આભાર! તમારા પ્રેમ અને ઓર્ડર બદલ ખૂબ ખૂબ આભાર!",
  },
  Punjab: {
    language: "Punjabi",
    message: "Dhanvaad ji! Tuhade vishwas aur order layi bahut dhanvaad!",
    nativeMessage: "ਧੰਨਵਾਦ ਜੀ! ਤੁਹਾਡੇ ਵਿਸ਼ਵਾਸ ਅਤੇ ਆਰਡਰ ਲਈ ਬਹੁਤ ਧੰਨਵਾਦ!",
  },
  Maharashtra: {
    language: "Marathi",
    message: "Dhanyavaad! Aplya vishvasabaddal manapasun aabhar!",
    nativeMessage: "धन्यवाद! आपल्या विश्वासाबद्दल मनापासून आभार!",
  },
  Karnataka: {
    language: "Kannada",
    message: "Dhanyavadagalu! Nimma preeti mathu order ge dhanyavadagalu!",
    nativeMessage: "ಧನ್ಯವಾದಗಳು! ನಿಮ್ಮ ಪ್ರೀತಿ ಮತ್ತು ಆರ್ಡರ್‌ಗೆ ಧನ್ಯವಾದಗಳು!",
  },
  Kerala: {
    language: "Malayalam",
    message: "Nandi! Ningalude snehatthinu nandi!",
    nativeMessage: "നന്ദി! നിങ്ങളുടെ സ്നേഹത്തിന് നന്ദി!",
  },
  Telangana: {
    language: "Telugu",
    message: "Dhanyavadalu! Mee premaku hrudayapoorvaka dhanyavadalu!",
    nativeMessage: "ధన్యవాదాలు! మీ ప్రేమకు హృదయపూర్వక ధన్యవాదాలు!",
  },
  AndhraPradesh: {
    language: "Telugu",
    message: "Dhanyavadalu! Mee premaku hrudayapoorvaka dhanyavadalu!",
    nativeMessage: "ధన్యవాదాలు! మీ ప్రేమకు హృదయపూర్వక ధన్యవాదాలు!",
  },
  WestBengal: {
    language: "Bengali",
    message: "Dhonnobad! Apnar bhalobasha o biswaser jonno dhonnobad!",
    nativeMessage: "ধন্যবাদ! আপনার ভালোবাসা ও বিশ্বাসের জন্য ধন্যবাদ!",
  },
  Odisha: {
    language: "Odia",
    message: "Dhanyabad! Apananka bishwas o order pain ashesha dhanyabad!",
    nativeMessage: "ଧନ୍ୟବାଦ! ଆପଣଙ୍କ ବିଶ୍ୱାସ ଓ ଅର୍ଡର ପାଇଁ ଅଶେଷ ଧନ୍ୟବାଦ!",
  },
  Assam: {
    language: "Assamese",
    message: "Dhonyobad! Aponar morom aru orderor babe dhonyobad!",
    nativeMessage: "ধন্যবাদ! আপোনাৰ মৰম আৰু অৰ୍ਡৰৰ বাবে ধন্যবাদ!",
  },
  Rajasthan: {
    language: "Hindi",
    message: "Aapke pyaar aur vishwas ke liye ghani khamma aur shukriya!",
    nativeMessage: "आपके प्यार और विश्वास के लिए घणी खम्मा और शुक्रिया!",
  },
  HindiBelt: {
    language: "Hindi",
    message: "Thank you! Aapke pyaar aur vishwas ke liye bahut-bahut shukriya!",
    nativeMessage: "धन्यवाद! आपके प्यार और विश्वास के लिए बहुत-बहुत शुक्रिया!",
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
  // Fallback: if text is short return whole string, else top 50%
  if (rawText.length < 500) return rawText;
  return rawText.slice(0, Math.floor(rawText.length * 0.5));
}

/**
 * Resolves State and Regional Greeting strictly from Customer Delivery Address.
 * If useNativeScript is true, regionalThankYou uses the native script text (e.g. Gujarati/Marathi/Tamil font).
 */
function resolveRegionalGreeting(rawText = "", useNativeScript = false) {
  const custAddress = extractCustomerAddress(rawText);
  const text = custAddress.toUpperCase();

  let matchInfo = { state: "India", ...STATE_MESSAGES.HindiBelt };

  // 1. Check Specific State Names in Customer Delivery Address
  if (/TAMIL\s*NADU|TAMILNADU|CHENNAI|COIMBATORE|MADURAI|TIRUCHIRAPPALLI|SALEM|TIRUPPUR|THIRUVALLUR|VELLORE|ERODE|TIRUNELVELI|KANCHEEPURAM|DINDIGUL|THANJAVUR|TUTICORIN|CUDDALORE/i.test(text)) {
    matchInfo = { state: "Tamil Nadu", ...STATE_MESSAGES.TamilNadu };
  } else if (/PUNJAB|LUDHIANA|AMRITSAR|JALANDHAR|PATIALA|BATHINDA|MOHALI|HOSHIARPUR|BATALA|PATHANKOT/i.test(text)) {
    matchInfo = { state: "Punjab", ...STATE_MESSAGES.Punjab };
  } else if (/MAHARASHTRA|MUMBAI|PUNE|NAGPUR|THANE|NASHIK|AURANGABAD|SOLAPUR|AMRAVATI|KOLHAPUR|NAVI MUMBAI|AKOLA|LATUR|DHULE/i.test(text)) {
    matchInfo = { state: "Maharashtra", ...STATE_MESSAGES.Maharashtra };
  } else if (/KARNATAKA|BENGALURU|BANGALORE|MYSURU|MYSORE|HUBLI|DHARWAD|MANGALORE|BELGAUM|GULBARGA|DAVANAGERE|BELLARY|SHIMOGA/i.test(text)) {
    matchInfo = { state: "Karnataka", ...STATE_MESSAGES.Karnataka };
  } else if (/KERALA|KOCHI|COCHIN|THIRUVANANTHAPURAM|TRIVANDRUM|KOZHIKODE|CALICUT|THRISSUR|KANNUR|KOLLAM|ALAPPUZHA|PALAKKAD|MALAPPURAM|KOTTAYAM/i.test(text)) {
    matchInfo = { state: "Kerala", ...STATE_MESSAGES.Kerala };
  } else if (/TELANGANA|HYDERABAD|SECUNDERABAD|WARANGAL|NIZAMABAD|KHAMMAM|KARIMNAGAR|RAMAGUNDAM/i.test(text)) {
    matchInfo = { state: "Telangana", ...STATE_MESSAGES.Telangana };
  } else if (/ANDHRA\s*PRADESH|ANDHRAPRADESH|VISAKHAPATNAM|VIZAG|VIJAYAWADA|GUNTUR|NELLORE|KURNOOL|RAJAHMUNDRY|TIRUPATI|KADAPA|KAKINADA/i.test(text)) {
    matchInfo = { state: "Andhra Pradesh", ...STATE_MESSAGES.AndhraPradesh };
  } else if (/WEST\s*BENGAL|BENGAL|WESTBENGAL|KOLKATA|CALCUTTA|HOWRAH|DURGAPUR|ASANSOL|SILIGURI|BARDHAMAN|MALDA|KHARAGPUR/i.test(text)) {
    matchInfo = { state: "West Bengal", ...STATE_MESSAGES.WestBengal };
  } else if (/ODISHA|ORISSA|BHUBANESWAR|CUTTACK|ROURKELA|BERHAMPUR|SAMBALPUR|PURI|BALASORE/i.test(text)) {
    matchInfo = { state: "Odisha", ...STATE_MESSAGES.Odisha };
  } else if (/ASSAM|GUWAHATI|SILCHAR|DIBRUGARH|JORHAT|NAGAON|TINSUKIA|TEZPUR/i.test(text)) {
    matchInfo = { state: "Assam", ...STATE_MESSAGES.Assam };
  } else if (/RAJASTHAN|JAIPUR|JODHPUR|KOTA|BIKANER|AJMER|UDAIPUR|BHILWARA|ALWAR|SIKAR|PALI/i.test(text)) {
    matchInfo = { state: "Rajasthan", ...STATE_MESSAGES.Rajasthan };
  } else if (/GUJARAT|AHMEDABAD|SURAT|VADODARA|RAJKOT|GANDHINAGAR|BHAVNAGAR|JAMNAGAR|JUNAGADH|ANAND|NAVSARI|MORBI|MEHSANA|BHARUCH/i.test(text)) {
    matchInfo = { state: "Gujarat", ...STATE_MESSAGES.Gujarat };
  } else {
    // 2. PIN Code Detection strictly inside Customer Delivery Address
    const pinMatch = custAddress.match(/\b([1-8]\d{5})\b/);
    if (pinMatch) {
      const pin2 = parseInt(pinMatch[1].substring(0, 2), 10);
      if (pin2 >= 60 && pin2 <= 64) matchInfo = { state: "Tamil Nadu", ...STATE_MESSAGES.TamilNadu };
      else if (pin2 >= 14 && pin2 <= 16) matchInfo = { state: "Punjab", ...STATE_MESSAGES.Punjab };
      else if (pin2 >= 40 && pin2 <= 44) matchInfo = { state: "Maharashtra", ...STATE_MESSAGES.Maharashtra };
      else if (pin2 >= 56 && pin2 <= 59) matchInfo = { state: "Karnataka", ...STATE_MESSAGES.Karnataka };
      else if (pin2 >= 67 && pin2 <= 69) matchInfo = { state: "Kerala", ...STATE_MESSAGES.Kerala };
      else if (pin2 >= 50 && pin2 <= 53) matchInfo = { state: "Telangana/AP", ...STATE_MESSAGES.Telangana };
      else if (pin2 >= 70 && pin2 <= 74) matchInfo = { state: "West Bengal", ...STATE_MESSAGES.WestBengal };
      else if (pin2 >= 75 && pin2 <= 77) matchInfo = { state: "Odisha", ...STATE_MESSAGES.Odisha };
      else if (pin2 >= 78 && pin2 <= 79) matchInfo = { state: "Assam", ...STATE_MESSAGES.Assam };
      else if (pin2 >= 30 && pin2 <= 34) matchInfo = { state: "Rajasthan", ...STATE_MESSAGES.Rajasthan };
      else if (pin2 >= 36 && pin2 <= 39) matchInfo = { state: "Gujarat", ...STATE_MESSAGES.Gujarat };
    }
  }

  const isNative = String(useNativeScript) === "true" || useNativeScript === true;

  return {
    state: matchInfo.state,
    regionalLanguage: matchInfo.language,
    regionalThankYouLatin: matchInfo.message,
    regionalThankYouNative: matchInfo.nativeMessage,
    regionalThankYou: isNative ? matchInfo.nativeMessage : matchInfo.message,
  };
}

module.exports = { resolveRegionalGreeting, STATE_MESSAGES };


module.exports = { resolveRegionalGreeting, STATE_MESSAGES };
