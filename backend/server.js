// server.js
import express from "express";
import session from "express-session";
import cors from "cors";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ===== Configuración Middleware =====
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS para permitir frontend separado
app.use(cors({
  origin: "https://valorant-10-mans-frontend.onrender.com",
  credentials: true
}));

// Sesión simple para admin
app.use(session({
  secret: "valorant-secret-key", // cambia a algo seguro
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 } // 1 hora
}));

// ===== MongoDB =====
const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/valorant";
mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("MongoDB conectado"))
  .catch(err => console.error("Error conectando MongoDB:", err));

const playerSchema = new mongoose.Schema({
  name: String,
  tag: String,
  matchesPlayed: { type: Number, default: 0 },
  avgACS: { type: Number, default: 0 },
  avgKDA: { type: Number, default: 0 },
  hsPercent: { type: Number, default: 0 },
  avgFirstBloods: { type: Number, default: 0 },
  winrate: { type: Number, default: 0 },
  score: { type: Number, default: 0 }
});

const matchSchema = new mongoose.Schema({
  players: [playerSchema],
  winnerTeam: String,
  createdAt: { type: Date, default: Date.now }
});

const Player = mongoose.model("Player", playerSchema);
const Match = mongoose.model("Match", matchSchema);

// ===== Rutas Públicas =====

// Leaderboard para frontend público
app.get("/leaderboard", async (req, res) => {
  try {
    const players = await Player.find().sort({ score: -1 });
    res.json(players);
  } catch (err) {
    res.status(500).json({ error: "Error cargando leaderboard" });
  }
});

// ===== Admin / Login =====
const ADMIN_USER = "admin";
const ADMIN_PASS = "password123"; // cambia a algo seguro

// Servir login.html
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "private/login.html"));
});

// Procesar login
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.user = username;
    return res.json({ message: "Login exitoso" });
  }
  res.status(401).json({ error: "Usuario o contraseña incorrectos" });
});

// Servir admin.html si hay sesión
app.get("/admin", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  res.sendFile(path.join(__dirname, "private/admin.html"));
});

// Logout
app.post("/api/logout", (req, res) => {
  req.session.destroy();
  res.json({ message: "Logout exitoso" });
});

// ===== Rutas Admin / CRUD jugadores =====

// Middleware para proteger rutas admin
function authMiddleware(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "No autorizado" });
  next();
}

// Listar jugadores
app.get("/api/admin/players", authMiddleware, async (req, res) => {
  try {
    const players = await Player.find().sort({ score: -1 });
    res.json(players);
  } catch (err) {
    res.status(500).json({ error: "Error cargando jugadores" });
  }
});

// Crear jugador
app.post("/api/admin/players", authMiddleware, async (req, res) => {
  const { name, tag } = req.body;
  if (!name || !tag) return res.status(400).json({ error: "Nombre y tag requeridos" });
  try {
    const existing = await Player.findOne({ name, tag });
    if (existing) return res.status(400).json({ error: "Jugador ya existe" });
    const player = new Player({ name, tag });
    await player.save();
    res.json({ message: "Jugador registrado", player });
  } catch (err) {
    res.status(500).json({ error: "Error creando jugador" });
  }
});

// Eliminar jugador
app.delete("/api/admin/players/:id", authMiddleware, async (req, res) => {
  try {
    await Player.findByIdAndDelete(req.params.id);
    res.json({ message: "Jugador eliminado" });
  } catch (err) {
    res.status(500).json({ error: "Error eliminando jugador" });
  }
});

// ===== Registrar partidas =====
app.post("/matches", async (req, res) => {
  const { match, winnerTeam } = req.body;
  if (!match || !winnerTeam) return res.status(400).json({ error: "Datos incompletos" });
  try {
    const newMatch = new Match({ players: match, winnerTeam });
    await newMatch.save();
    res.json({ message: "Partida registrada" });
  } catch (err) {
    res.status(500).json({ error: "Error registrando partida" });
  }
});

// ===== Iniciar servidor =====
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
