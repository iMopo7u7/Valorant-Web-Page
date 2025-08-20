import { MongoClient } from "mongodb";
import dotenv from "dotenv";
dotenv.config();

let db, playersCollection, matchesCollection;

export async function connectDB() {
  if (!process.env.MONGODB_URI) {
    console.error("❌ ERROR: MONGODB_URI no está definido.");
    process.exit(1);
  }

  try {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    db = client.db("valorantDB");
    playersCollection = db.collection("players");
    matchesCollection = db.collection("matches");
    console.log("✅ Conectado a MongoDB");
  } catch (err) {
    console.error("❌ Error conectando a MongoDB:", err);
    process.exit(1);
  }
}

export { db, playersCollection, matchesCollection };
