import express from "express";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";
import bodyParser from "body-parser";
import cors from "cors";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Datos de ejemplo
let players = []; // { id, name, tag, matchesPlayed }
let matches = []; // { matchData, winnerTeam }

// Middlewares
app.use(bodyParser.json());

// CORS para frontend público
app.use(cors({
  origin: ["https://valorant-10-mans-frontend.onrender.com"], // tu frontend
  credentials: true
}));

// Sesiones
app.use(session({
  secret: "valorant-secret",
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // cambiar a true si usas HTTPS
}));

// Servir archivos estáticos de public si los hubiera
app.use(express.static(path.join(__dirname, "public")));

// ---------------------- FRONTEND PÚBLICO ----------------------
// Leaderboard público
app.get("/leaderboard", (req, res) => {
  // Ejemplo: calcula avgACS, avgKDA, etc.
  const leaderboard = players.map(player => {
    const playedMatches = matches.filter(m => m.match.some(p => p.name === player.name && p.tag === player.tag));
    const totalKills = playedMatches.reduce((sum, m) => sum + m.match.find(p => p.name === player.name && p.tag === player.tag).kills, 0);
    const totalDeaths = playedMatches.reduce((sum, m) => sum + m.match.find(p => p.name === player.name && p.tag === player.tag).deaths, 0);
    const totalAssists = playedMatches.reduce((sum, m) => sum + m.match.find(p => p.name === player.name && p.tag === player.tag).assists, 0);
    const totalACS = playedMatches.reduce((sum, m) => sum + m.match.find(p => p.name === player.name && p.tag === player.tag).acs, 0);
    const totalFB = playedMatches.reduce((sum, m) => sum + m.match.find(p => p.name === player.name && p.tag === player.tag).firstBloods, 0);
    const totalHS = playedMatches.reduce((sum, m) => sum + m.match.find(p => p.name === player.name && p.tag === player.tag).hsPercent, 0);
    const played = playedMatches.length;

    return {
      name: player.name,
      tag: player.tag,
      avgACS: played ? totalACS / played : 0,
      avgKDA: played ? (totalKills + totalAssists) / (totalDeaths || 1) : 0,
      hsPercent: played ? totalHS / played : 0,
      avgFirstBloods: played ? totalFB / played : 0,
      winrate: played ? (playedMatches.filter(m => m.winnerTeam === "A").length / played) * 100 : 0,
      score: played ? (totalKills + totalAssists + totalFB) / (totalDeaths || 1) : 0
    };
  });

  res.json(leaderboard);
});

// ---------------------- ADMIN PRIVADO ----------------------

// Servir login y admin.html
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "private/login.html"));
});

app.get("/admin", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  res.sendFile(path.join(__dirname, "private/admin.html"));
});

// Login
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  // Ejemplo simple
  if (username === "admin" && password === "1234") {
    req.session.user = { username };
    return res.json({ message: "Login exitoso" });
  }
  res.status(401).json({ error: "Usuario o contraseña incorrectos" });
});

// Logout
app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ message: "Sesión cerrada" });
  });
});

// Middleware de autenticación para admin
function authAdmin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "No autorizado" });
  next();
}

// CRUD Jugadores
app.get("/api/admin/players", authAdmin, (req, res) => {
  res.json(players);
});

app.post("/api/admin/players", authAdmin, (req, res) => {
  const { name, tag } = req.body;
  if (!name || !tag) return res.status(400).json({ error: "Faltan datos" });
  const id = `${Date.now()}`; // simple ID
  players.push({ id, name, tag, matchesPlayed: 0 });
  res.json({ message: "Jugador agregado", id });
});

app.delete("/api/admin/players/:id", authAdmin, (req, res) => {
  const { id } = req.params;
  players = players.filter(p => p.id !== id);
  res.json({ message: "Jugador eliminado" });
});

// Registrar partidas (opcional)
app.post("/api/admin/matches", authAdmin, (req, res) => {
  const { match, winnerTeam } = req.body;
  if (!match || !winnerTeam) return res.status(400).json({ error: "Faltan datos de partida" });
  matches.push({ match, winnerTeam });
  // Actualizar matchesPlayed
  match.forEach(p => {
    const player = players.find(pl => pl.name === p.name && pl.tag === p.tag);
    if (player) player.matchesPlayed = (player.matchesPlayed || 0) + 1;
  });
  res.json({ message: "Partida registrada" });
});

// ---------------------- INICIO SERVIDOR ----------------------
app.listen(PORT, () => {
  console.log(`Backend corriendo en http://localhost:${PORT}`);
});
