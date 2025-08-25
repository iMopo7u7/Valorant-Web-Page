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

    // Recalcular puntos históricos al iniciar
    await recalcAllPlayersScore();
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

  // Factores de stats
  const killsFactor = playerStats.kills;
  const deathsFactor = playerStats.deaths;
  const assistsFactor = playerStats.assists;
  const acsFactor = playerStats.acs;
  const fbFactor = playerStats.firstBloods;

  // Score base
  let points = 0;
  points += killsFactor * 1.2;
  points += assistsFactor * 0.8;
  points += acsFactor / 100;
  points += fbFactor * 2;
  points -= deathsFactor * 0.8;

  // Ajuste por victoria/derrota
  points += won ? 5 : -5;

  // Limitar entre -20 y 20
  points = Math.max(Math.min(points, 20), -20);

  // Puntos bonus
  let bonus = 0;
  if (killsFactor >= 25 || acsFactor >= 250) bonus = 5;
  else if (killsFactor >= 20 || acsFactor >= 220) bonus = 3;
  else if (killsFactor >= 15 || acsFactor >= 200) bonus = 1;

  return { totalScore: points + bonus, baseScore: points, bonus };
}

// -------------------
// --- Recalcular scores históricos
// -------------------
async function recalcAllPlayersScore() {
  const allPlayers = await playersCollection.find().toArray();
  for (const player of allPlayers) {
    const matches = await matchesCollection.find({ "match.name": player.name, "match.tag": player.tag }).toArray();
    let totalScore = 0;
    for (const m of matches) {
      const playerTeam = m.match.findIndex(p => p.name === player.name && p.tag === player.tag) < 5 ? "A" : "B";
      const pStats = m.match.find(p => p.name === player.name && p.tag === player.tag);
      const { totalScore: mp } = calculateMatchScore(pStats, m.winnerTeam, playerTeam);
      totalScore += mp;
    }
    await playersCollection.updateOne(
      { name: player.name, tag: player.tag },
      { $set: { score: totalScore } }
    );
  }
  console.log("✅ Recalculados scores de todos los jugadores");
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
      score: 0
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
// --- CRUD Matches con score
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
            wins: playerTeam === winnerTeam ? 1 : 0,
            score: totalScore
          },
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
// --- Leaderboard con rangos
// -------------------
app.get("/leaderboard", async (req, res) => {
  try {
    const players = await playersCollection.find().toArray();
    players.sort((a, b) => (b.score || 0) - (a.score || 0));

    const leaderboard = players.map((p, i) => {
      let rank = "Diamond";
      if (i < 3) rank = "Radiant";
      else if (i < 10) rank = "Immortal";
      else if (i < 20) rank = "Ascendant";

      return {
        name: p.name,
        tag: p.tag,
        score: p.score || 0,
        matchesPlayed: p.matchesPlayed,
        rank,
        badges: p.badges || [],
        social: p.social || {}
      };
    });

    res.json(leaderboard);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error generando leaderboard" });
  }
});

// -------------------
// --- Servidor
// -------------------
connectDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));
});
