const https = require("https");

const WA_API_URL = process.env.WA_API_URL || "https://laterpro.in/api/whatsapp/send-media";
const WA_API_KEY = process.env.WA_API_KEY || "";
function sendWhatsAppMedia({
  apiKey,
  number,
  fileData,
  fileName,
  filename,
  caption,
  mimeType,
  mimetype,
  typeName = "Media",
}) {
  const activeApiKey = (apiKey || WA_API_KEY || "").toString().trim();
  return new Promise((resolve, reject) => {
    if (!activeApiKey) {
      return reject(new Error("WhatsApp API Key is missing. Please configure your LaterPro WhatsApp API Key in Settings."));
    }
    if (!fileData) {
      return reject(new Error("Missing fileData for WhatsApp media dispatch"));
    }

    const rawNum = (number || "").toString().replace(/[^0-9]/g, "");
    if (!rawNum || rawNum.length < 10) {
      return reject(new Error("Valid receiver WhatsApp number is required. Please configure your WhatsApp number in Settings."));
    }
    const formattedNumber = rawNum.length === 10 ? `91${rawNum}` : rawNum;

    const resolvedFileName = fileName || filename || "attachment.pdf";
    const resolvedMimeType =
      mimeType ||
      mimetype ||
      (fileData.startsWith("data:image") ? "image/png" : "application/pdf");
    const resolvedCaption = caption !== undefined ? caption : "";

    const payloadObj = {
      number: formattedNumber,
      fileData,
      fileName: resolvedFileName,
      filename: resolvedFileName,
      mimeType: resolvedMimeType,
      mimetype: resolvedMimeType,
    };
    if (resolvedCaption && resolvedCaption.trim() !== "") {
      payloadObj.caption = resolvedCaption;
    }

    const payload = JSON.stringify(payloadObj);

    const req = https.request(
      WA_API_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": activeApiKey,
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(body);
            if (res.statusCode >= 400 || (parsed && parsed.success === false)) {
              const errMsg = parsed?.error || parsed?.message || `WhatsApp API error (status ${res.statusCode})`;
              return reject(new Error(errMsg));
            }
            console.log(
              `[WhatsApp API] ${typeName} sent successfully to ${formattedNumber}. MessageId: ${
                parsed?.data?.messageId || "N/A"
              }`
            );
            resolve(parsed);
          } catch (e) {
            if (res.statusCode >= 400) {
              return reject(new Error(`WhatsApp API error (status ${res.statusCode}): ${body}`));
            }
            console.log(`[WhatsApp API] ${typeName} response status: ${res.statusCode} body: ${body}`);
            resolve({ status: res.statusCode, body });
          }
        });
      }
    );

    req.on("error", (err) => {
      console.error(`[WhatsApp API Error] Failed to send ${typeName} to ${formattedNumber}:`, err.message);
      reject(err);
    });

    req.write(payload);
    req.end();
  });
}

module.exports = {
  sendWhatsAppMedia,
};
