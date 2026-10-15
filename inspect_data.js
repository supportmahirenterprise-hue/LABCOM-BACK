const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const { getDb } = require("./db");

async function check() {
  const db = await getDb();
  const custEmails = await db.collection("customers").aggregate([
    { $group: { _id: "$userEmail", count: { $sum: 1 } } }
  ]).toArray();
  console.log("Customer emails & counts:", custEmails);

  const returnEmails = await db.collection("returns").aggregate([
    { $group: { _id: "$userEmail", count: { $sum: 1 } } }
  ]).toArray();
  console.log("Return emails & counts:", returnEmails);

  const orderEmails = await db.collection("orders").aggregate([
    { $group: { _id: "$userEmail", count: { $sum: 1 } } }
  ]).toArray();
  console.log("Order emails & counts:", orderEmails);

  const userSettings = await db.collection("user_settings").find({}).toArray();
  console.log("UserSettings count:", userSettings.length);
  console.log("UserSettings emails:", userSettings.map(s => s.email));

  const users = await db.collection("users").find({}).toArray();
  console.log("Users in users col:", users.length);
  console.log("Users emails:", users.map(u => u.email));
  process.exit(0);
}

check().catch((e) => {
  console.error(e);
  process.exit(1);
});
