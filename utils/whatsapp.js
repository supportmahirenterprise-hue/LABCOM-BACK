const https = require("https");

const WA_API_URL = "https://wa.lextrack.in/api/whatsapp/send-media";
const WA_API_KEY = "wa_c6854599bd4b7a54cad78edbdd6ace51";
const WA_BEARER_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2YTVkZjQ3MzBjOWQwZTA0Nzg2OTBkMDkiLCJ1c2VybmFtZSI6IlZpc2hhbCIsImlhdCI6MTc4ODc4Mjg2MSwiZXhwIjoxNzkxMzc0ODYxfQ.mfXOSRinxqUpVpXBpaLQ4wHwaz0i9_Ni7RTxOi19k-4";
const DEFAULT_RECEIVER_NUMBER = "918140148878";

function sendWhatsAppMedia({ number = DEFAULT_RECEIVER_NUMBER, fileData, typeName = "Media" }) {
  return new Promise((resolve, reject) => {
    if (!fileData) {
      return reject(new Error("Missing fileData for WhatsApp media dispatch"));
    }

    const rawNum = (number || DEFAULT_RECEIVER_NUMBER).toString().replace(/[^0-9]/g, "");
    const formattedNumber = rawNum.length === 10 ? `91${rawNum}` : rawNum;

    const payload = JSON.stringify({
      number: formattedNumber,
      fileData,
    });

    const req = https.request(
      WA_API_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": WA_API_KEY,
          Authorization: `Bearer ${WA_BEARER_TOKEN}`,
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
