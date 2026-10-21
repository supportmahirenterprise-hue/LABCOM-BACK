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
    nativeMessage: "ధన్యవాదాలు! మీ ప్రేమకు హృదయపూర్వಕ ధన్యవాదాలు!",
  },
  AndhraPradesh: {
    language: "Telugu",
    message: "Dhanyavadalu! Mee premaku hrudayapoorvaka dhanyavadalu!",
    nativeMessage: "ధన్యవాదాలు! మీ ప్రేమకు హృదయపూర్వಕ ధన్యవాదాలు!",
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
    nativeMessage: "ধন্যবাদ! আপোনাৰ মৰম আৰু অৰ্ডৰৰ বাবে ধন্যবাদ!",
  },
  Rajasthan: {
    language: "Hindi",
    message: "Aapke pyaar aur vishwas ke liye ghani khamma aur shukriya!",
    nativeMessage: "आपके प्यार और विश्वास के लिए घणी खम्मा और शुक्रिया!",
  },
  Goa: {
    language: "Konkani",
    message: "Dev Boren Korum! Tuhajya order khatir khup khup dhanyavaad!",
    nativeMessage: "देव बरे करू! तुमच्या विश्वासाबद्दल आणि ऑर्डर बद्दल खूप खूप धन्यवाद!",
  },
  Bihar: {
    language: "Hindi",
    message: "Thank you! Aapke pyaar aur vishwas ke liye bahut-bahut shukriya!",
    nativeMessage: "धन्यवाद! आपके प्यार और विश्वास के लिए बहुत-बहुत शुक्रिया!",
  },
  UttarPradesh: {
    language: "Hindi",
    message: "Thank you! Aapke pyaar aur vishwas ke liye bahut-bahut shukriya!",
    nativeMessage: "धन्यवाद! आपके प्यार और विश्वास के लिए बहुत-बहुत शुक्रिया!",
  },
  MadhyaPradesh: {
    language: "Hindi",
    message: "Thank you! Aapke pyaar aur vishwas ke liye bahut-bahut shukriya!",
    nativeMessage: "धन्यवाद! आपके प्यार और विश्वास के लिए बहुत-बहुत शुक्रिया!",
  },
  Haryana: {
    language: "Hindi",
    message: "Thank you! Aapke pyaar aur vishwas ke liye bahut-bahut shukriya!",
    nativeMessage: "धन्यवाद! आपके प्यार और विश्वास के लिए बहुत-बहुत शुक्रिया!",
  },
  Delhi: {
    language: "Hindi",
    message: "Thank you! Aapke pyaar aur vishwas ke liye bahut-bahut shukriya!",
    nativeMessage: "धन्यवाद! आपके प्यार और विश्वास के लिए बहुत-बहुत शुक्रिया!",
  },
  Jharkhand: {
    language: "Hindi",
    message: "Thank you! Aapke pyaar aur vishwas ke liye bahut-bahut shukriya!",
    nativeMessage: "धन्यवाद! आपके प्यार और विश्वास के लिए बहुत-बहुत शुक्रिया!",
  },
  Chhattisgarh: {
    language: "Hindi",
    message: "Thank you! Aapke pyaar aur vishwas ke liye bahut-bahut shukriya!",
    nativeMessage: "धन्यवाद! आपके प्यार और विश्वास के लिए बहुत-बहुत शुक्रिया!",
  },
  Uttarakhand: {
    language: "Hindi",
    message: "Thank you! Aapke pyaar aur vishwas ke liye bahut-bahut shukriya!",
    nativeMessage: "धन्यवाद! आपके प्यार और विश्वास के लिए बहुत-बहुत शुक्रिया!",
  },
  HimachalPradesh: {
    language: "Hindi",
    message: "Thank you! Aapke pyaar aur vishwas ke liye bahut-bahut shukriya!",
    nativeMessage: "धन्यवाद! आपके प्यार और विश्वास के लिए बहुत-बहुत शुक्रिया!",
  },
  JammuAndKashmir: {
    language: "Hindi",
    message: "Thank you! Aapke pyaar aur vishwas ke liye bahut-bahut shukriya!",
    nativeMessage: "धन्यवाद! आपके प्यार और विश्वास के लिए बहुत-बहुत शुक्रिया!",
  },
  HindiBelt: {
    language: "Hindi",
    message: "Thank you! Aapke pyaar aur vishwas ke liye bahut-bahut shukriya!",
    nativeMessage: "धन्यवाद! आपके प्यार और विश्वास के लिए बहुत-बहुत शुक्रिया!",
  },
};

/**
 * Isolates the Customer Delivery Address block from the label text.
 * Strictly prevents the seller return / warehouse address from leaking into customer address.
 */
function extractCustomerAddress(rawText = "") {
  if (!rawText) return "";

  // 1. If text already looks like an isolated address (e.g. passed from customerAddress field)
  if (!/If undelivered|return to|Sold by|TAX INVOICE/i.test(rawText)) {
    return rawText.trim();
  }

  // 2. Try extracting between "Customer Address" and "If undelivered, return to" / "Product Details"
  const m = rawText.match(
    /Customer Address\s*[:\s]*([\s\S]*?)(?:If undelivered|return to|Sold by|Product Details|TAX INVOICE|BILL TO|Shipping Address)/i
  );
  if (m && m[1].trim().length > 10) {
    let cleaned = m[1].trim();
    // Additional sanity cutoff if "return to" or seller details remain inside
    const cutoffIdx = cleaned.search(/(?:return to|if undelivered)/i);
    if (cutoffIdx !== -1) {
      cleaned = cleaned.slice(0, cutoffIdx).trim();
    }
    if (cleaned.length > 5) return cleaned;
  }

  // Fallback: discard anything after return or invoice headers
  const splitCut = rawText.split(/(?:If undelivered|return to|Sold by|Product Details|TAX INVOICE)/i)[0];
  if (splitCut && splitCut.trim().length > 15) {
    return splitCut.trim();
  }

  if (rawText.length < 500) return rawText;
  return rawText.slice(0, Math.floor(rawText.length * 0.5));
}

// Explicit State regexes with strict word boundaries (\b)
const STATE_RULES = [
  { state: "Bihar", regex: /\b(BIHAR)\b/i, info: STATE_MESSAGES.Bihar },
  { state: "Gujarat", regex: /\b(GUJARAT)\b/i, info: STATE_MESSAGES.Gujarat },
  { state: "Maharashtra", regex: /\b(MAHARASHTRA)\b/i, info: STATE_MESSAGES.Maharashtra },
  { state: "Tamil Nadu", regex: /\b(TAMIL\s*NADU|TAMILNADU)\b/i, info: STATE_MESSAGES.TamilNadu },
  { state: "Uttar Pradesh", regex: /\b(UTTAR\s*PRADESH|U\.?P\.?)\b/i, info: STATE_MESSAGES.UttarPradesh },
  { state: "Karnataka", regex: /\b(KARNATAKA)\b/i, info: STATE_MESSAGES.Karnataka },
  { state: "Rajasthan", regex: /\b(RAJASTHAN)\b/i, info: STATE_MESSAGES.Rajasthan },
  { state: "West Bengal", regex: /\b(WEST\s*BENGAL|WESTBENGAL)\b/i, info: STATE_MESSAGES.WestBengal },
  { state: "Madhya Pradesh", regex: /\b(MADHYA\s*PRADESH|M\.?P\.?)\b/i, info: STATE_MESSAGES.MadhyaPradesh },
  { state: "Haryana", regex: /\b(HARYANA)\b/i, info: STATE_MESSAGES.Haryana },
  { state: "Delhi", regex: /\b(DELHI|NEW\s*DELHI)\b/i, info: STATE_MESSAGES.Delhi },
  { state: "Punjab", regex: /\b(PUNJAB)\b/i, info: STATE_MESSAGES.Punjab },
  { state: "Kerala", regex: /\b(KERALA)\b/i, info: STATE_MESSAGES.Kerala },
  { state: "Telangana", regex: /\b(TELANGANA)\b/i, info: STATE_MESSAGES.Telangana },
  { state: "Andhra Pradesh", regex: /\b(ANDHRA\s*PRADESH|ANDHRAPRADESH)\b/i, info: STATE_MESSAGES.AndhraPradesh },
  { state: "Odisha", regex: /\b(ODISHA|ORISSA)\b/i, info: STATE_MESSAGES.Odisha },
  { state: "Jharkhand", regex: /\b(JHARKHAND)\b/i, info: STATE_MESSAGES.Jharkhand },
  { state: "Assam", regex: /\b(ASSAM)\b/i, info: STATE_MESSAGES.Assam },
  { state: "Chhattisgarh", regex: /\b(CHHATTISGARH)\b/i, info: STATE_MESSAGES.Chhattisgarh },
  { state: "Uttarakhand", regex: /\b(UTTARAKHAND|UTTRANCHAL)\b/i, info: STATE_MESSAGES.Uttarakhand },
  { state: "Himachal Pradesh", regex: /\b(HIMACHAL\s*PRADESH)\b/i, info: STATE_MESSAGES.HimachalPradesh },
  { state: "Jammu and Kashmir", regex: /\b(JAMMU\s*(?:AND|&)?\s*KASHMIR|J&K)\b/i, info: STATE_MESSAGES.JammuAndKashmir },
  { state: "Goa", regex: /\b(GOA)\b/i, info: STATE_MESSAGES.Goa },
  { state: "Tripura", regex: /\b(TRIPURA)\b/i, info: STATE_MESSAGES.HindiBelt },
  { state: "Meghalaya", regex: /\b(MEGHALAYA)\b/i, info: STATE_MESSAGES.HindiBelt },
  { state: "Manipur", regex: /\b(MANIPUR)\b/i, info: STATE_MESSAGES.HindiBelt },
  { state: "Nagaland", regex: /\b(NAGALAND)\b/i, info: STATE_MESSAGES.HindiBelt },
  { state: "Mizoram", regex: /\b(MIZORAM)\b/i, info: STATE_MESSAGES.HindiBelt },
  { state: "Arunachal Pradesh", regex: /\b(ARUNACHAL\s*PRADESH)\b/i, info: STATE_MESSAGES.HindiBelt },
  { state: "Sikkim", regex: /\b(SIKKIM)\b/i, info: STATE_MESSAGES.HindiBelt },
  { state: "Chandigarh", regex: /\b(CHANDIGARH)\b/i, info: STATE_MESSAGES.Punjab },
  { state: "Puducherry", regex: /\b(PUDUCHERRY|PONDICHERRY)\b/i, info: STATE_MESSAGES.TamilNadu },
  { state: "Ladakh", regex: /\b(LADAKH)\b/i, info: STATE_MESSAGES.HindiBelt },
];

// District / major city keywords with STRICT \b word boundary wrappers to prevent substring collision
// e.g. Anand city in Gujarat must NEVER match Ramanand Sada!
const DISTRICT_RULES = [
  // Bihar Districts
  {
    state: "Bihar",
    regex: /\b(PATNA|GAYA|BHAGALPUR|MUZAFFARPUR|DARBHANGA|PURNEA|PURNIA|BEGUSARAI|KATIHAR|MUNGER|MOTIHARI|SAHARSA|SASARAM|HAJIPUR|DEHRI|SIWAN|BETTIAH|KISHANGANJ|JAMALPUR|BUXAR|JEHANABAD|NAWADA|MADHUBANI|SAMASTIPUR|SITAMARHI|GOPALGANJ|SUPAUL|ARARIA|SHEOHAR|BANKA|JAMUI|LAKHISARAI|SHEIKHPURA|ROHTAS|BAHERI|KOTHRA)\b/i,
    info: STATE_MESSAGES.Bihar,
  },
  // Gujarat Cities (strictly word-bounded)
  {
    state: "Gujarat",
    regex: /\b(AHMEDABAD|SURAT|VADODARA|RAJKOT|GANDHINAGAR|BHAVNAGAR|JAMNAGAR|JUNAGADH|ANAND|NAVSARI|MORBI|MEHSANA|BHARUCH|PORBANDAR|AMRELI|SURENDRANAGAR|VALSAD|HIMATNAGAR|PALANPUR|VERAVAL|GODHRA|PATAN|DAHOD|BOTAD|ANKLESHWAR)\b/i,
    info: STATE_MESSAGES.Gujarat,
  },
  // Tamil Nadu
  {
    state: "Tamil Nadu",
    regex: /\b(CHENNAI|COIMBATORE|MADURAI|TIRUCHIRAPPALLI|SALEM|TIRUPPUR|THIRUVALLUR|VELLORE|ERODE|TIRUNELVELI|KANCHEEPURAM|DINDIGUL|THANJAVUR|TUTICORIN|CUDDALORE|PATTUKKOTTAI|NAGERCOIL|HOSUR|KUMBAKONAM)\b/i,
    info: STATE_MESSAGES.TamilNadu,
  },
  // Maharashtra
  {
    state: "Maharashtra",
    regex: /\b(MUMBAI|PUNE|NAGPUR|THANE|NASHIK|AURANGABAD|SOLAPUR|AMRAVATI|KOLHAPUR|NAVI\s*MUMBAI|AKOLA|LATUR|DHULE|AHMEDNAGAR|CHANDRAPUR|PARBHANI|JALNA|JALGAON|SANGLI|SATARA|RATNAGIRI)\b/i,
    info: STATE_MESSAGES.Maharashtra,
  },
  // Uttar Pradesh
  {
    state: "Uttar Pradesh",
    regex: /\b(LUCKNOW|KANPUR|VARANASI|AGRA|PRAYAGRAJ|ALLAHABAD|MEERUT|GHAZIABAD|NOIDA|GREATER\s*NOIDA|BAREILLY|ALIGARH|MORADABAD|GORAKHPUR|SAHARANPUR|FIROZABAD|JHANSI|MUZAFFARNAGAR|MATHURA|AYODHYA|FAIZABAD|KUSHINAGAR|MIRZAPUR|RAEBARELI|SULTANPUR|UNNAO|HARDOI)\b/i,
    info: STATE_MESSAGES.UttarPradesh,
  },
  // Karnataka
  {
    state: "Karnataka",
    regex: /\b(BENGALURU|BANGALORE|MYSURU|MYSORE|HUBLI|DHARWAD|MANGALORE|BELGAUM|GULBARGA|DAVANAGERE|BELLARY|SHIMOGA|TUMKUR|UDUPI|BIJAPUR|BIDAR|HASSAN|CHITRADURGA)\b/i,
    info: STATE_MESSAGES.Karnataka,
  },
  // Kerala
  {
    state: "Kerala",
    regex: /\b(KOCHI|COCHIN|THIRUVANANTHAPURAM|TRIVANDRUM|KOZHIKODE|CALICUT|THRISSUR|KANNUR|KOLLAM|ALAPPUZHA|PALAKKAD|MALAPPURAM|KOTTAYAM|KASARAGOD|WAYANAD|IDUKKI|PATHANAMTHITTA)\b/i,
    info: STATE_MESSAGES.Kerala,
  },
  // Telangana
  {
    state: "Telangana",
    regex: /\b(HYDERABAD|SECUNDERABAD|WARANGAL|NIZAMABAD|KHAMMAM|KARIMNAGAR|RAMAGUNDAM|MAHBUBNAGAR|NALGONDA|ADILABAD)\b/i,
    info: STATE_MESSAGES.Telangana,
  },
  // Andhra Pradesh
  {
    state: "Andhra Pradesh",
    regex: /\b(VISAKHAPATNAM|VIZAG|VIJAYAWADA|GUNTUR|NELLORE|KURNOOL|RAJAHMUNDRY|TIRUPATI|KADAPA|KAKINADA|ANANTAPUR|ELURU|ONGOLE|VIZIANAGARAM)\b/i,
    info: STATE_MESSAGES.AndhraPradesh,
  },
  // West Bengal
  {
    state: "West Bengal",
    regex: /\b(KOLKATA|CALCUTTA|HOWRAH|DURGAPUR|ASANSOL|SILIGURI|BARDHAMAN|MALDA|KHARAGPUR|HALDIA|JALPAIGURI|DARJEELING|BERHAMPORE)\b/i,
    info: STATE_MESSAGES.WestBengal,
  },
  // Rajasthan
  {
    state: "Rajasthan",
    regex: /\b(JAIPUR|JODHPUR|KOTA|BIKANER|AJMER|UDAIPUR|BHILWARA|ALWAR|SIKAR|PALI|SRI\s*GANGANAGAR|BHARATPUR|BEAWAR|BARMER|HANUMANGARH)\b/i,
    info: STATE_MESSAGES.Rajasthan,
  },
  // Madhya Pradesh
  {
    state: "Madhya Pradesh",
    regex: /\b(BHOPAL|INDORE|GWALIOR|JABALPUR|UJJAIN|SAGAR|DEWAS|SATNA|RATLAM|REWA|MURWARA|KATNI|SINGRAULI|BURHANPUR|KHANDWA|BHIND|CHHINDWARA|GUNA|SHIVPURI)\b/i,
    info: STATE_MESSAGES.MadhyaPradesh,
  },
  // Haryana
  {
    state: "Haryana",
    regex: /\b(GURUGRAM|GURGAON|FARIDABAD|PANIPAT|AMBALA|YAMUNANAGAR|ROHTAK|HISAR|KARNAL|SONIPAT|PANCHKULA|BHIWANI|SIRSA|BAHADURGARH|JIND)\b/i,
    info: STATE_MESSAGES.Haryana,
  },
  // Punjab
  {
    state: "Punjab",
    regex: /\b(LUDHIANA|AMRITSAR|JALANDHAR|PATIALA|BATHINDA|MOHALI|HOSHIARPUR|BATALA|PATHANKOT|MOIDAPUR|ABOHAR|MALERKOTLA|KHANNA|PHAGWARA)\b/i,
    info: STATE_MESSAGES.Punjab,
  },
  // Odisha
  {
    state: "Odisha",
    regex: /\b(BHUBANESWAR|CUTTACK|ROURKELA|BERHAMPUR|SAMBALPUR|PURI|BALASORE|BHADRAK|BARIPADA|JEYPORE)\b/i,
    info: STATE_MESSAGES.Odisha,
  },
  // Jharkhand
  {
    state: "Jharkhand",
    regex: /\b(RANCHI|JAMSHEDPUR|DHANBAD|BOKARO|DEOGHAR|HAZARIBAGH|GIRIDIH|RAMGARH|MEDININAGAR|CHAIBASA)\b/i,
    info: STATE_MESSAGES.Jharkhand,
  },
  // Assam
  {
    state: "Assam",
    regex: /\b(GUWAHATI|SILCHAR|DIBRUGARH|JORHAT|NAGAON|TINSUKIA|TEZPUR|BONGAIGAON|DHUBRI|DIPHU)\b/i,
    info: STATE_MESSAGES.Assam,
  },
  // Chhattisgarh
  {
    state: "Chhattisgarh",
    regex: /\b(RAIPUR|BHILAI|BILASPUR|KORBA|DURG|RAJNANDGAON|JAGDALPUR|AMBIKAPUR|DHAMTARI)\b/i,
    info: STATE_MESSAGES.Chhattisgarh,
  },
  // Uttarakhand
  {
    state: "Uttarakhand",
    regex: /\b(DEHRADUN|HARIDWAR|ROORKEE|HALDWANI|RUDRAPUR|KASHIPUR|RISHIKESH|NAINITAL|KOTDWAR)\b/i,
    info: STATE_MESSAGES.Uttarakhand,
  },
  // Himachal Pradesh
  {
    state: "Himachal Pradesh",
    regex: /\b(SHIMLA|DHARAMSHALA|SOLAN|MANDI|KULLU|BILASPUR\s+HP|CHAMBA|HAMIRPUR\s+HP|UNA)\b/i,
    info: STATE_MESSAGES.HimachalPradesh,
  },
  // Goa
  {
    state: "Goa",
    regex: /\b(PANAJI|PANJIM|MARGAO|VASCO(?:\s*DA\s*GAMA)?|MAPUSA|PONDA|SOUTH\s*GOA|NORTH\s*GOA)\b/i,
    info: STATE_MESSAGES.Goa,
  },
];

/**
 * Resolves State and Regional Greeting strictly from Customer Delivery Address.
 * If useNativeScript is true, regionalThankYou uses the native script text.
 */
function resolveRegionalGreeting(rawText = "", useNativeScript = false) {
  const custAddress = extractCustomerAddress(rawText);
  const text = custAddress.toUpperCase();

  let matchInfo = { state: "India", ...STATE_MESSAGES.HindiBelt };

  // TIER 1: Explicit State Name Match with word boundaries
  let stateFound = false;
  for (const rule of STATE_RULES) {
    if (rule.regex.test(text)) {
      matchInfo = { state: rule.state, ...rule.info };
      stateFound = true;
      break;
    }
  }

  // TIER 2: PIN Code Detection strictly inside Customer Delivery Address
  if (!stateFound) {
    const pinMatch = custAddress.match(/\b([1-8]\d{5})\b/);
    if (pinMatch) {
      const pinFull = parseInt(pinMatch[1], 10);
      const pin2 = parseInt(pinMatch[1].substring(0, 2), 10);

      if (pinFull >= 403001 && pinFull <= 403999) {
        matchInfo = { state: "Goa", ...STATE_MESSAGES.Goa };
        stateFound = true;
      } else if (pin2 === 11) {
        matchInfo = { state: "Delhi", ...STATE_MESSAGES.Delhi };
        stateFound = true;
      } else if (pin2 >= 12 && pin2 <= 13) {
        matchInfo = { state: "Haryana", ...STATE_MESSAGES.Haryana };
        stateFound = true;
      } else if (pin2 >= 14 && pin2 <= 16) {
        matchInfo = { state: "Punjab", ...STATE_MESSAGES.Punjab };
        stateFound = true;
      } else if (pin2 === 17) {
        matchInfo = { state: "Himachal Pradesh", ...STATE_MESSAGES.HimachalPradesh };
        stateFound = true;
      } else if (pin2 >= 18 && pin2 <= 19) {
        matchInfo = { state: "Jammu and Kashmir", ...STATE_MESSAGES.JammuAndKashmir };
        stateFound = true;
      } else if (pin2 >= 20 && pin2 <= 28) {
        // 244-249 Uttarakhand, rest UP
        if (pinFull >= 244000 && pinFull <= 249999 && !/\bUP\b|UTTAR/i.test(text)) {
          matchInfo = { state: "Uttarakhand", ...STATE_MESSAGES.Uttarakhand };
        } else {
          matchInfo = { state: "Uttar Pradesh", ...STATE_MESSAGES.UttarPradesh };
        }
        stateFound = true;
      } else if (pin2 >= 30 && pin2 <= 34) {
        matchInfo = { state: "Rajasthan", ...STATE_MESSAGES.Rajasthan };
        stateFound = true;
      } else if (pin2 >= 36 && pin2 <= 39) {
        matchInfo = { state: "Gujarat", ...STATE_MESSAGES.Gujarat };
        stateFound = true;
      } else if (pin2 >= 40 && pin2 <= 44) {
        matchInfo = { state: "Maharashtra", ...STATE_MESSAGES.Maharashtra };
        stateFound = true;
      } else if (pin2 >= 45 && pin2 <= 48) {
        matchInfo = { state: "Madhya Pradesh", ...STATE_MESSAGES.MadhyaPradesh };
        stateFound = true;
      } else if (pin2 === 49) {
        matchInfo = { state: "Chhattisgarh", ...STATE_MESSAGES.Chhattisgarh };
        stateFound = true;
      } else if (pin2 >= 50 && pin2 <= 53) {
        matchInfo = { state: "Telangana/AP", ...STATE_MESSAGES.Telangana };
        stateFound = true;
      } else if (pin2 >= 56 && pin2 <= 59) {
        matchInfo = { state: "Karnataka", ...STATE_MESSAGES.Karnataka };
        stateFound = true;
      } else if (pin2 >= 60 && pin2 <= 64) {
        matchInfo = { state: "Tamil Nadu", ...STATE_MESSAGES.TamilNadu };
        stateFound = true;
      } else if (pin2 >= 67 && pin2 <= 69) {
        matchInfo = { state: "Kerala", ...STATE_MESSAGES.Kerala };
        stateFound = true;
      } else if (pin2 >= 70 && pin2 <= 74) {
        matchInfo = { state: "West Bengal", ...STATE_MESSAGES.WestBengal };
        stateFound = true;
      } else if (pin2 >= 75 && pin2 <= 77) {
        matchInfo = { state: "Odisha", ...STATE_MESSAGES.Odisha };
        stateFound = true;
      } else if (pin2 >= 78 && pin2 <= 79) {
        matchInfo = { state: "Assam", ...STATE_MESSAGES.Assam };
        stateFound = true;
      } else if (pin2 >= 80 && pin2 <= 85) {
        // 80, 84, 85 Bihar; 81, 82, 83 Bihar/Jharkhand
        if (/\bJHARKHAND\b/i.test(text)) {
          matchInfo = { state: "Jharkhand", ...STATE_MESSAGES.Jharkhand };
        } else {
          matchInfo = { state: "Bihar", ...STATE_MESSAGES.Bihar };
        }
        stateFound = true;
      }
    }
  }

  // TIER 3: City / District Match with strict word boundaries
  if (!stateFound) {
    for (const rule of DISTRICT_RULES) {
      if (rule.regex.test(text)) {
        matchInfo = { state: rule.state, ...rule.info };
        stateFound = true;
        break;
      }
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

module.exports = { resolveRegionalGreeting, STATE_MESSAGES, extractCustomerAddress };
