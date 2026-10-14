const https = require("https");

const WA_API_URL = process.env.WA_API_URL || "https://wa.lextrack.in/api/whatsapp/send-media";
const WA_API_KEY = process.env.WA_API_KEY || "wa_c6854599bd4b7a54cad78edbdd6ace51";
const DEFAULT_RECEIVER_NUMBER = process.env.WA_DEFAULT_RECEIVER || "";

function sendWhatsAppMedia({
  apiKey,
  number = DEFAULT_RECEIVER_NUMBER,
  fileData,
  fileName,
  filename,
  caption,
  mimeType,
  mimetype,
  typeName = "Media",
}) {
  const activeApiKey = apiKey || WA_API_KEY;
  return new Promise((resolve, reject) => {
    if (!fileData) {
      return reject(new Error("Missing fileData for WhatsApp media dispatch"));
    }

    const rawNum = (number || DEFAULT_RECEIVER_NUMBER || "").toString().replace(/[^0-9]/g, "");
    if (!rawNum || rawNum.length < 10) {
      return reject(new Error("Valid receiver WhatsApp number is required"));
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
            console.log(
              `[WhatsApp API] ${typeName} sent successfully to ${formattedNumber}. MessageId: ${
                parsed?.data?.messageId || "N/A"
              }`
            );
            resolve(parsed);
          } catch (e) {
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
  DEFAULT_RECEIVER_NUMBER,
};
