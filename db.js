const { MongoClient, ServerApiVersion } = require("mongodb");

const uri = process.env.MONGODB_URI;
let client;
let clientPromise;

if (!uri) {
  console.warn("⚠️ Warning: MONGODB_URI is not defined in environment variables.");
} else {
  const options = {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  };

  client = new MongoClient(uri, options);
  clientPromise = client.connect()
    .then((c) => {
      console.log(" Connected to MongoDB successfully.");
      return c;
    })
    .catch((err) => {
      console.error("❌ MongoDB connection error:", err);
      throw err;
    });
}

async function getDb() {
  if (!clientPromise) {
    throw new Error("MongoDB client is not configured. Please check MONGODB_URI.");
  }
  const connectedClient = await clientPromise;
  return connectedClient.db();
}

module.exports = { getDb, clientPromise };
