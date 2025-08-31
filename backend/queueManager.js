// newQueueBackend.js
import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import session from "express-session";
import dotenv from "dotenv";

dotenv.config();
const router = express.Router();

let db, usersCollection, customMatchesCollection;

// -------------------
// --- Conexión MongoDB
// -------------------
async function initDB(externalDb) {
  if (externalDb) {
    db = externalDb;
  } else {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    db = client.db("valorantDB");
  }
  usersCollection = db.collection("users");
  customMatchesCollection = db.collection("customMatches");
  console.log("✅ Conectado a DB de cola y usuarios Discord");
}

// -------------------
// --- Middleware para sesiones (ya viene de server.js, opcional si quieres)
// -------------------
function requireAuth(req, res, next) {
  if (req.session?.userId) next();
  else res.status(401).json({ error: "No autorizado" });
}

// -------------------
// --- Auth Discord
// -------------------
router.get("/auth/discord", (req, res) => {
  const redirectUri = process.env.DISCORD_REDIRECT_URI;
  const clientId = process.env.DISCORD_CLIENT_ID;
  const scope = "identify";
  const discordUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}`;
  res.redirect(discordUrl);
});

router.get("/auth/discord/callback", async (req, res) => {
  const code = req.query.code;
  try {
    // 1️⃣ Intercambiar code por access_token
    const params = new URLSearchParams();
    params.append("client_id", process.env.DISCORD_CLIENT_ID);
    params.append("client_secret", process.env.DISCORD_CLIENT_SECRET);
    params.append("grant_type", "authorization_code");
    params.append("code", code);
    params.append("redirect_uri", process.env.DISCORD_REDIRECT_URI);

    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params
    });
    const tokenData = await tokenRes.json();
    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const discordUser = await userRes.json();

    // Guardar/actualizar usuario en Mongo
    const user = {
      discordId: discordUser.id,
      username: discordUser.username,
      discriminator: discordUser.discriminator,
      avatar: discordUser.avatar,
      updatedAt: new Date()
    };

    await usersCollection.updateOne(
      { discordId: discordUser.id },
      { $set: user },
      { upsert: true }
    );

req.session.userId = discordUser.id;
req.session.save(err => {
  if (err) {
    console.error("Error guardando sesión:", err);
    return res.status(500).send("Error en login");
  }
  res.redirect(process.env.FRONTEND_URL || "/");
});

// -------------------
// --- Endpoints Users
// -------------------
router.get("/users/me", requireAuth, async (req, res) => {
  const user = await usersCollection.findOne({ discordId: req.session.userId });
  res.json(user);
});

router.post("/users/update-riot", requireAuth, async (req, res) => {
  const { riotId } = req.body;
  await usersCollection.updateOne(
    { discordId: req.session.userId },
    { $set: { riotId, updatedAt: new Date() } }
  );
  res.json({ success: true });
});

// -------------------
// --- Endpoints Queue / Custom Match
// -------------------
router.get("/queue/active", async (req, res) => {
  const matches = await customMatchesCollection.find({ status: { $in: ["waiting","in_progress"] } }).toArray();
  res.json(matches);
});

router.post("/queue/join", requireAuth, async (req, res) => {
  const { matchId } = req.body;
  await customMatchesCollection.updateOne(
    { _id: ObjectId(matchId) },
    { $addToSet: { players: req.session.userId }, $set: { updatedAt: new Date() } }
  );
  const matches = await customMatchesCollection.find({ status: { $in: ["waiting","in_progress"] } }).toArray();
  res.json({ success: true, activeMatches: matches });
});

router.post("/queue/start", requireAuth, async (req, res) => {
  const { map } = req.body;
  const newMatch = {
    leaderId: req.session.userId,
    players: [req.session.userId],
    map,
    roomCode: "",
    trackerUrl: "",
    status: "waiting",
    createdAt: new Date(),
    updatedAt: new Date()
  };
  const result = await customMatchesCollection.insertOne(newMatch);
  res.json({ success: true, match: result.ops[0] });
});

router.post("/queue/submit-room-code", requireAuth, async (req, res) => {
  const { matchId, roomCode } = req.body;
  await customMatchesCollection.updateOne(
    { _id: ObjectId(matchId), leaderId: req.session.userId },
    { $set: { roomCode, updatedAt: new Date() } }
  );
  res.json({ success: true });
});

router.post("/queue/submit-tracker", requireAuth, async (req, res) => {
  const { matchId, trackerUrl } = req.body;
  await customMatchesCollection.updateOne(
    { _id: ObjectId(matchId), leaderId: req.session.userId },
    { $set: { trackerUrl, status: "completed", updatedAt: new Date() } }
  );
  res.json({ success: true });
});

// -------------------
// --- Export router y función initDB
// -------------------
export { router as newQueueRouter, initDB as initQueueDB };
