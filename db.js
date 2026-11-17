const { MongoClient, ServerApiVersion } = require("mongodb");
const fs = require("fs");
const path = require("path");

const DEFAULT_MONGO_URI =
  "mongodb://vishalnexios_db_user:DQKapdyKSM2vHAMI@ac-jndnfjh-shard-00-00.ofvtno6.mongodb.net:27017,ac-jndnfjh-shard-00-01.ofvtno6.mongodb.net:27017,ac-jndnfjh-shard-00-02.ofvtno6.mongodb.net:27017/labelpro?ssl=true&replicaSet=atlas-2mez1a-shard-0&authSource=admin&retryWrites=true&w=majority";

function resolveMongoUri() {
  let uri = process.env.MONGODB_URI || "";

  if ((!uri || uri.startsWith("mongodb+srv://")) && typeof window === "undefined") {
    try {
      const candidatePaths = [
        path.resolve(__dirname, ".env"),
        path.resolve(process.cwd(), "backend/.env"),
        path.resolve(process.cwd(), ".env"),
        path.resolve(__dirname, "../.env"),
      ];
      for (const envPath of candidatePaths) {
        if (fs.existsSync(envPath)) {
          const fileContent = fs.readFileSync(envPath, "utf-8");
          const match = fileContent.match(/MONGODB_URI=(.*)/);
          if (match && match[1]) {
            uri = match[1].trim();
            break;
          }
        }
      }
    } catch (e) {
      // ignore
    }
  }

  // Fallback if missing or rewrite cluster0 srv URI to direct replicaSet string
  if (!uri || uri.includes("cluster0.ofvtno6.mongodb.net")) {
    uri = DEFAULT_MONGO_URI;
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
