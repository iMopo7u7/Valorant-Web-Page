import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv";
import session from "express-session";
import MongoStore from "connect-mongo";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================
// CORS
// ==========================
const allowedOrigins = [
  "https://valorant-10-mans-frontend.onrender.com",
  "https://valorant-10-mans.onrender.com"
];

app.set('trust proxy', 1);
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("CORS policy error"), false);
  },
  credentials: true,
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));

app.use(express.json());

// ==========================
// Sesiones con MongoStore
// ==========================
const sessionStore = MongoStore.create({
  mongoUrl: process.env.MONGODB_URI,
  collectionName: "sessions",
  ttl: 60 * 60,
});

app.use(session({
  secret: process.env.SESSION_SECRET || "valorantsecret",
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    maxAge: 60 * 60 * 1000
  }
}));

// ==========================
// Conexión MongoDB
// ==========================
if (!process.env.MONGODB_URI) {
  console.error("❌ ERROR: MONGODB_URI no está definido.");
  process.exit(1);
}

let db, playersCollection, matchesCollection, eventsCollection;
let usersCollection, customMatchesCollection;

async function connectDB() {
  try {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    db = client.db("valorantDB");

    // Colecciones principales
    playersCollection = db.collection("players");
    matchesCollection = db.collection("matches");
    eventsCollection = db.collection("events");

    // Colecciones de queue y Discord
    usersCollection = db.collection("users");
    customMatchesCollection = db.collection("customMatches");

    console.log("✅ Conectado a MongoDB");
  } catch (err) {
    console.error("❌ Error conectando a MongoDB:", err);
    process.exit(1);
  }
}

// ==========================
// Middleware Auth Discord
// ==========================
function requireAuth(req, res, next) {
  if (req.session?.userId) next();
  else res.status(401).json({ error: "No autorizado" });
}

// ==========================
// Queue & Discord Endpoints
// ==========================
const apiRouter = express.Router();

// --- Discord OAuth login
apiRouter.get("/auth/discord", (req, res) => {
  const redirectUri = process.env.DISCORD_REDIRECT_URI;
  const clientId = process.env.DISCORD_CLIENT_ID;
  const scope = "identify";
  const discordUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}`;
  res.redirect(discordUrl);
});

apiRouter.get("/auth/discord/callback", async (req, res) => {
  const code = req.query.code;
  try {
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
      res.redirect("https://valorant-10-mans-frontend.onrender.com");
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error en login Discord" });
  }
});

// --- Users endpoints
apiRouter.get("/users/me", requireAuth, async (req, res) => {
  const user = await usersCollection.findOne({ discordId: req.session.userId });
  res.json(user);
});

apiRouter.post("/users/update-riot", requireAuth, async (req, res) => {
  const { riotId } = req.body;
  await usersCollection.updateOne(
    { discordId: req.session.userId },
    { $set: { riotId, updatedAt: new Date() } }
  );
  res.json({ success: true });
});

// --- Queue / Custom Matches
apiRouter.get("/queue/active", async (req, res) => {
  const matches = await customMatchesCollection.find({ status: { $in: ["waiting","in_progress"] } }).toArray();
  res.json(matches);
});

apiRouter.post("/queue/join", requireAuth, async (req, res) => {
  const { matchId } = req.body;
  await customMatchesCollection.updateOne(
    { _id: ObjectId(matchId) },
    { $addToSet: { players: req.session.userId }, $set: { updatedAt: new Date() } }
  );
  const matches = await customMatchesCollection.find({ status: { $in: ["waiting","in_progress"] } }).toArray();
  res.json({ success: true, activeMatches: matches });
});

apiRouter.post("/queue/start", requireAuth, async (req, res) => {
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

apiRouter.post("/queue/submit-room-code", requireAuth, async (req, res) => {
  const { matchId, roomCode } = req.body;
  await customMatchesCollection.updateOne(
    { _id: ObjectId(matchId), leaderId: req.session.userId },
    { $set: { roomCode, updatedAt: new Date() } }
  );
  res.json({ success: true });
});

apiRouter.post("/queue/submit-tracker", requireAuth, async (req, res) => {
  const { matchId, trackerUrl } = req.body;
  await customMatchesCollection.updateOne(
    { _id: ObjectId(matchId), leaderId: req.session.userId },
    { $set: { trackerUrl, status: "completed", updatedAt: new Date() } }
  );
  res.json({ success: true });
});

// ==========================
// [Aquí iría todo tu CRUD de players, matches, leaderboard, login]
// Puedes pegarlo tal como lo tienes ahora
// ==========================

// Montar router API
app.use("/api", apiRouter);

// ==========================
// Servidor
// ==========================
connectDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));
});
