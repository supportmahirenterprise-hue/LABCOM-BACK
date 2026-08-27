const { MongoClient, ServerApiVersion } = require("mongodb");
const fs = require("fs");
const path = require("path");

function resolveMongoUri() {
  let uri = process.env.MONGODB_URI || "";

  if ((!uri || uri.startsWith("mongodb+srv://")) && typeof window === "undefined") {
    try {
      const envPath = path.resolve(process.cwd(), ".env");
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, "utf-8");
        const match = content.match(/MONGODB_URI=(.*)/);
        if (match && match[1]) {
          uri = match[1].trim();
        }
      }
    } catch (e) {
      // ignore
    }
  }

  // Auto-rewrite cluster0.ofvtno6 srv URI if present to prevent Windows/Node22 TLS alert 80
  if (uri && uri.includes("cluster0.ofvtno6.mongodb.net")) {
    uri =
      "mongodb://vishalnexios_db_user:DQKapdyKSM2vHAMI@ac-jndnfjh-shard-00-00.ofvtno6.mongodb.net:27017,ac-jndnfjh-shard-00-01.ofvtno6.mongodb.net:27017,ac-jndnfjh-shard-00-02.ofvtno6.mongodb.net:27017/labelpro?ssl=true&replicaSet=atlas-2mez1a-shard-0&authSource=admin&retryWrites=true&w=majority";
  }

  return uri;
}

let client = null;
let clientPromise = null;

function getClientPromise() {
  const uri = resolveMongoUri();
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
        clientPromise = null;
        throw err;
      });
  }

  return clientPromise;
}

// Initial connection attempt (catch to prevent unhandled rejection from crashing the server)
getClientPromise()?.catch(() => {});

async function getDb() {
  const cp = getClientPromise();
  if (!cp) {
    throw new Error("MongoDB client is not configured. Please check MONGODB_URI.");
  }
  const connectedClient = await cp;
  return connectedClient.db();
}

module.exports = { getDb, clientPromise };
