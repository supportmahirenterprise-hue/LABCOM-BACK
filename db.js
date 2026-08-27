const { MongoClient, ServerApiVersion } = require("mongodb");

const uri = process.env.MONGODB_URI;
let client = null;
let clientPromise = null;

function getClientPromise() {
  if (!uri) {
    console.warn("⚠️ Warning: MONGODB_URI is not defined in environment variables.");
    return null;
  }

  if (!clientPromise) {
    const options = {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
    };

    client = new MongoClient(uri, options);
    clientPromise = client
      .connect()
      .then((c) => {
        console.log("✅ Connected to MongoDB successfully.");
        return c;
      })
      .catch((err) => {
        console.error("❌ MongoDB connection error:", err.message || err);
        // Clear cached promise so subsequent attempts can retry connecting
        clientPromise = null;
        throw err;
      });
  }

  return clientPromise;
}

// Initial connection attempt (catch to prevent unhandled rejection from crashing the server)
if (uri) {
  getClientPromise()?.catch(() => {});
}

async function getDb() {
  const cp = getClientPromise();
  if (!cp) {
    throw new Error("MongoDB client is not configured. Please check MONGODB_URI.");
  }
  const connectedClient = await cp;
  return connectedClient.db();
}

module.exports = { getDb, clientPromise };
