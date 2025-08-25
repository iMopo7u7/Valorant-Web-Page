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

// -------------------
// --- CORS
// -------------------
const allowedOrigins = [
  "https://valorant-10-mans-frontend.onrender.com",
  "https://valorant-10-mans.onrender.com"
];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("CORS policy error"), false);
  },
  credentials: true,
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));

app.options('*', cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));

// -------------------
// --- Body parser
// -------------------
app.use(express.json());

// -------------------
// --- Sesiones con MongoStore
// -------------------
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
  cookie: { maxAge: 60 * 60 * 1000 }
}));

// -------------------
// --- Conexión MongoDB
// -------------------
if (!process.env.MONGODB_URI) {
  console.error("❌ ERROR: MONGODB_URI no está definido.");
  process.exit(1);
}

let db, playersCollection, matchesCollection, eventsCollection;

async function connectDB() {
  try {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    db = client.db("valorantDB");
    playersCollection = db.collection("players");
    matchesCollection = db.collection("matches");
    eventsCollection = db.collection("events");
    console.log("✅ Conectado a MongoDB");

  } catch (err) {
    console.error("❌ Error conectando a MongoDB:", err);
    process.exit(1);
  }
}

// -------------------
// --- Función de cálculo de score por partida
// -------------------
function calculateMatchScore(playerStats, matchWinnerTeam, playerTeam) {
  const won = playerTeam === matchWinnerTeam;

  let points = 0;
  points += playerStats.kills * 1.2;
  points += playerStats.assists * 0.8;
  points += playerStats.acs / 100;
  points += playerStats.firstBloods * 2;
  points -= playerStats.deaths * 0.8;

  // Ajuste por victoria/derrota
  points += won ? 5 : -5;

  // Limitar base points a -20 / 20
  points = Math.max(Math.min(points, 20), -20);

  // Puntos bonus
  let bonus = 0;
  if (playerStats.kills >= 25 || playerStats.acs >= 250) bonus = 5;
  else if (playerStats.kills >= 20 || playerStats.acs >= 220) bonus = 3;
  else if (playerStats.kills >= 15 || playerStats.acs >= 200) bonus = 1;

  const totalScore = Math.round(points + bonus); // redondeamos a entero
  return { totalScore, basePoints: Math.round(points), bonus };
}

// -------------------
// --- Login / Admin
// -------------------
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "1234";

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.isAdmin = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ error: "Usuario o contraseña incorrectos" });
  }
});

function requireAdmin(req, res, next) {
  if (req.session.isAdmin) next();
  else res.status(403).json({ error: "Acceso denegado" });
}

// -------------------
// --- CRUD Players
// -------------------
app.post("/players", requireAdmin, async (req, res) => {
  try {
    const { name, tag, badges = [], social = {} } = req.body;
    if (!name || !tag) return res.status(400).json({ error: "Nombre y tag requeridos" });

    const exists = await playersCollection.findOne({ name, tag });
    if (exists) return res.status(400).json({ error: "Jugador ya existe" });

    const newPlayer = {
      name: name.trim(),
      tag: tag.trim(),
      totalKills: 0,
      totalDeaths: 0,
      totalAssists: 0,
      totalACS: 0,
      totalFirstBloods: 0,
      totalHeadshotKills: 0,
      matchesPlayed: 0,
      wins: 0,
      badges,
      social,
      score: 0 // campo score
    };

    await playersCollection.insertOne(newPlayer);
    res.json({ message: "Jugador añadido exitosamente" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al añadir jugador" });
  }
});

app.get("/players", requireAdmin, async (req, res) => {
  try {
    const players = await playersCollection.find().toArray();
    res.json(players);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener jugadores" });
  }
});

// -------------------
// --- CRUD Matches con cálculo de score
// -------------------
app.post("/matches", requireAdmin, async (req, res) => {
  try {
    const { match, winnerTeam, score: matchScore, map } = req.body;
    if (!Array.isArray(match) || match.length === 0) return res.status(400).json({ error: "Formato inválido" });

    const newMatch = { match, winnerTeam, score: matchScore, map, date: new Date() };
    await matchesCollection.insertOne(newMatch);

    for (const p of match) {
      const playerTeam = match.indexOf(p) < 5 ? "A" : "B";
      const { totalScore } = calculateMatchScore(p, winnerTeam, playerTeam);

      const currentPlayer = await playersCollection.findOne({ name: p.name, tag: p.tag });
      const newTotalScore = Math.max((currentPlayer.score || 0) + totalScore, 0);

      await playersCollection.updateOne(
        { name: p.name, tag: p.tag },
        {
          $inc: {
            totalKills: p.kills,
            totalDeaths: p.deaths,
            totalAssists: p.assists,
            totalACS: p.acs,
            totalFirstBloods: p.firstBloods,
            matchesPlayed: 1,
            wins: playerTeam === winnerTeam ? 1 : 0
          },
          $set: { score: newTotalScore }
        }
      );
    }

    res.json({ message: "Partida añadida exitosamente" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al añadir partida" });
  }
});

// -------------------
// --- Leaderboard
// -------------------
app.get("/leaderboard", async (req, res) => {
  try {
    const players = await playersCollection.find().toArray();
    players.sort((a, b) => (b.score || 0) - (a.score || 0));
    res.json(players);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error generando leaderboard" });
  }
});

// -------------------
// --- Endpoints adicionales para frontend
// -------------------
app.get("/matches-count", async (req, res) => {
  try {
    const count = await matchesCollection.countDocuments();
    res.json({ count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener total de partidas" });
  }
});

app.get("/players-count", async (req, res) => {
  try {
    const count = await playersCollection.countDocuments();
    res.json({ count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener total de jugadores" });
  }
});

app.get("/last-match", async (req, res) => {
  try {
    const lastMatch = await matchesCollection.find().sort({ date: -1 }).limit(1).toArray();
    if (lastMatch.length === 0) return res.json({ date: null });
    res.json({ date: lastMatch[0].date });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener última partida" });
  }
});

// -------------------
// --- Servidor
// -------------------
connectDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));
});
