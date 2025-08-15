import express from "express";
import cors from "cors";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Para __dirname en ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware
app.use(cors());
app.use(express.json());

// Configurar sesiones
app.use(session({
  secret: process.env.SESSION_SECRET || "clave-super-secreta",
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // HTTPS -> true
}));

// --- LOGIN ADMIN ---
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "1234";

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.user = username;
    return res.json({ success: true });
  }
  res.status(401).json({ error: "Credenciales inválidas" });
});

app.get("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

// Middleware para proteger rutas
function authMiddleware(req, res, next) {
  if (req.session.user) return next();
  res.redirect("/login.html");
}

// --- CONEXIÓN MONGO ---
if (!process.env.MONGODB_URI) {
  console.error("❌ MONGODB_URI no definido.");
  process.exit(1);
}

let db, playersCollection, matchesCollection;

async function connectDB() {
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

// --- APIs de leaderboard y jugadores ---
app.post("/players", async (req, res) => {
  try {
    const { name, tag } = req.body;
    if (!name || !tag) return res.status(400).json({ error: "Nombre y tag requeridos" });

    const exists = await playersCollection.findOne({
      name: { $regex: `^${name}$`, $options: "i" },
      tag: { $regex: `^${tag}$`, $options: "i" },
    });
    if (exists) return res.status(400).json({ error: "Jugador ya existe" });

    await playersCollection.insertOne({
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
    });
    res.json({ message: "Jugador añadido" });
  } catch {
    res.status(500).json({ error: "Error interno" });
  }
});

app.get("/players", async (req, res) => {
  try {
    const players = await playersCollection.find().toArray();
    res.json(players);
  } catch {
    res.status(500).json({ error: "Error al obtener jugadores" });
  }
});

// Añadir partida
app.post("/matches", async (req, res) => {
  try {
    const { match, winnerTeam } = req.body;
    if (!Array.isArray(match) || match.length !== 10) return res.status(400).json({ error: "Array de 10 jugadores requerido" });
    if (!["A","B"].includes(winnerTeam)) return res.status(400).json({ error: "Equipo ganador inválido" });

    const seenPlayers = new Set();
    for (const p of match) {
      const required = ["kills","deaths","assists","acs","firstBloods","hsPercent"];
      if (!p.name || !p.tag || required.some(n => typeof p[n]!=="number" || p[n]<0 || (n==="hsPercent" && p[n]>100))) {
        return res.status(400).json({ error: `Datos inválidos para ${p.name}#${p.tag}` });
      }
      const key = `${p.name.toLowerCase()}#${p.tag.toLowerCase()}`;
      if (seenPlayers.has(key)) return res.status(400).json({ error: `Jugador repetido: ${p.name}#${p.tag}` });
      seenPlayers.add(key);
    }

    await matchesCollection.insertOne({ match, winnerTeam, date: new Date() });

    for (const p of match) {
      const playerTeam = match.indexOf(p)<5 ? "A":"B";
      const headshotKills = Math.round((p.hsPercent/100)*p.kills);
      await playersCollection.updateOne(
        { name: { $regex: `^${p.name}$`, $options: "i" }, tag: { $regex: `^${p.tag}$`, $options: "i" } },
        { $inc: {
          totalKills: p.kills,
          totalDeaths: p.deaths,
          totalAssists: p.assists,
          totalACS: p.acs,
          totalFirstBloods: p.firstBloods,
          totalHeadshotKills: headshotKills,
          matchesPlayed: 1,
          wins: playerTeam===winnerTeam?1:0
        }}
      );
    }
    res.json({ message: "Partida añadida" });
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: "Error interno" });
  }
});

// Leaderboard
app.get("/leaderboard", async (req, res) => {
  try {
    const players = await playersCollection.find().toArray();
    const withScores = players.map(p=>{
      const matches = p.matchesPlayed||0;
      const avgKills = matches?p.totalKills/matches:0;
      const avgDeaths = matches?p.totalDeaths/matches:1;
      const avgACS = matches?p.totalACS/matches:0;
      const avgFirstBloods = matches?p.totalFirstBloods/matches:0;
      const avgAssists = matches?p.totalAssists/matches:0;
      const winrate = matches?p.wins/matches*100:0;
      const hsPercent = p.totalKills?(p.totalHeadshotKills/p.totalKills*100):0;
      const avgKDA = avgDeaths===0?avgKills:avgKills/avgDeaths;
      const cappedKills = Math.min(avgKills,30);
      const impactKillsScore = (avgFirstBloods*1.5)+(cappedKills-avgFirstBloods);
      const scoreRaw = (avgACS*1.5)+(impactKillsScore*1.2)+(avgAssists*0.8)+(hsPercent*1.0)+(winrate*1.0)-(avgDeaths*1.0);
      const reliabilityFactor = Math.min(matches/5,1);
      const consistencyBonus = 1+Math.min(matches,20)/100;
      const finalScore = scoreRaw*consistencyBonus*reliabilityFactor;

      return {
        name:p.name, tag:p.tag, avgKills, avgDeaths, avgACS, avgFirstBloods,
        avgAssists, hsPercent, winrate, avgKDA, score:finalScore
      };
    });
    withScores.sort((a,b)=>b.score-a.score);
    res.json(withScores);
  } catch(err){
    console.error(err);
    res.status(500).json({ error: "Error al generar leaderboard" });
  }
});

// Historial
app.get("/matches/:name/:tag", async (req,res)=>{
  try{
    const {name,tag}=req.params;
    const matches = await matchesCollection.find({
      match: {$elemMatch:{
        name:{$regex:`^${name}$`,$options:"i"},
        tag:{$regex:`^${tag}$`,$options:"i"}
      }}
    }).toArray();
    res.json(matches);
  } catch {
    res.status(500).json({ error: "Error al obtener historial" });
  }
});

// --- SERVIR ADMIN PROTEGIDO ---
app.get("/admin.html", authMiddleware, (req,res)=>{
  res.sendFile(path.join(__dirname,"public","admin.html"));
});

// --- SERVIR DEMÁS ARCHIVOS ESTÁTICOS ---
app.use(express.static(path.join(__dirname,"public")));

// --- INICIO ---
connectDB().then(()=>{
  app.listen(PORT,()=>console.log(`🚀 Servidor corriendo en puerto ${PORT}`));
});
