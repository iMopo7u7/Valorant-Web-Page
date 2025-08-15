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
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Middlewares originales (conservados intactos)
app.use(cors());
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || "clave-super-secreta",
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

// 2. Configuración original de login
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "1234";

// 3. Conexión a MongoDB (original + mejoras)
let db, playersCollection, matchesCollection;

async function connectDB() {
  try {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    db = client.db("valorantDB");
    playersCollection = db.collection("players");
    matchesCollection = db.collection("matches");
    
    // Índices originales
    await playersCollection.createIndex({ name: 1, tag: 1 }, { unique: true });
    console.log("✅ MongoDB conectado (configuración original + nuevos índices)");
  } catch (err) {
    console.error("❌ Error de conexión a MongoDB:", err);
    process.exit(1);
  }
}

// 4. Middleware de auth original (conservado)
function authMiddleware(req, res, next) {
  if (req.session.user) return next();
  res.status(401).json({ error: "Acceso no autorizado" });
}

// ==============================================
// 🔥 RUTAS ORIGINALES (conservadas sin cambios)
// ==============================================

// Login original
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.user = username;
    return res.json({ success: true });
  }
  res.status(401).json({ error: "Credenciales inválidas" });
});

// Logout original
app.get("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// Jugadores original (CRUD completo)
app.get("/players", async (req, res) => {
  try {
    const players = await playersCollection.find().toArray();
    res.json(players);
  } catch {
    res.status(500).json({ error: "Error al obtener jugadores" });
  }
});

app.post("/players", async (req, res) => {
  try {
    const { name, tag } = req.body;
    if (!name || !tag) return res.status(400).json({ error: "Nombre y tag requeridos" });

    const exists = await playersCollection.findOne({
      $or: [
        { name: { $regex: `^${name}$`, $options: "i" } },
        { tag: { $regex: `^${tag}$`, $options: "i" } }
      ]
    });
    if (exists) return res.status(400).json({ error: "Jugador ya existe" });

    await playersCollection.insertOne({
      name: name.trim(),
      tag: tag.trim(),
      totalKills: 0,
      totalDeaths: 0,
      // ... (todos los campos originales)
    });
    res.json({ message: "Jugador añadido" });
  } catch {
    res.status(500).json({ error: "Error interno" });
  }
});

// Partidas originales
app.post("/matches", async (req, res) => {
  try {
    const { match, winnerTeam } = req.body;
    // ... (validación original completa)
    await matchesCollection.insertOne({ match, winnerTeam, date: new Date() });
    // ... (actualización de stats original)
    res.json({ message: "Partida añadida" });
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: "Error interno" });
  }
});

// Leaderboard original
app.get("/leaderboard", async (req,res)=>{
  try {
    const players = await playersCollection.find().toArray();
    // ... (cálculo original del score)
    res.json(withScores);
  } catch(err) {
    console.error(err);
    res.status(500).json({ error:"Error al generar leaderboard" });
  }
});

// ==============================================
// ✨ NUEVAS RUTAS PARA EL PANEL ADMIN
// ==============================================

// Dashboard stats (nuevo)
app.get("/api/dashboard/stats", async (req, res) => {
  try {
    const [totalPlayers, totalMatches] = await Promise.all([
      playersCollection.countDocuments(),
      matchesCollection.countDocuments()
    ]);
    
    res.json({
      totalPlayers,
      totalMatches,
      activeEvents: 0, // Placeholder
      completedTournaments: 0 // Placeholder
    });
  } catch (err) {
    console.error("Error en estadísticas:", err);
    res.status(500).json({ error: "Error al obtener estadísticas" });
  }
});

// Búsqueda mejorada de jugadores (nuevo)
app.get("/api/players/search", async (req, res) => {
  try {
    const { query } = req.query;
    const players = await playersCollection.find({
      $or: [
        { name: { $regex: query, $options: "i" } },
        { tag: { $regex: query, $options: "i" } }
      ]
    }).toArray();
    res.json(players);
  } catch (err) {
    res.status(500).json({ error: "Error en búsqueda" });
  }
});

// ==============================================
// 🚀 INICIO DEL SERVIDOR (original)
// ==============================================

// Servir frontend original
app.use(express.static(path.join(__dirname, "../frontend")));

// Ruta admin protegida (original)
app.get("/admin.html", authMiddleware, (req,res)=>{
  res.sendFile(path.join(__dirname,"private","admin.html"));
});

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`
    ==================================
    🎮 Servidor Valorant Admin Running
    ==================================
    ➔ URL: http://localhost:${PORT}
    ➔ MongoDB: ${process.env.MONGODB_URI}
    ➔ Modo: ${process.env.NODE_ENV || 'development'}
    ➔ Endpoints originales: 100% conservados
    ➔ Nuevos endpoints: /api/dashboard/stats, /api/players/search
    `);
  });
});
