// server.js - Backend completo ES Modules, compatible con frontend separado
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración __dirname en ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware
app.use(cors()); // permite requests desde tu frontend externo
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Archivos de datos
const PLAYERS_FILE = path.join(__dirname, "players.json");
const MATCHES_FILE = path.join(__dirname, "matches.json");

// Funciones de lectura/escritura
function readPlayers() {
  if (!fs.existsSync(PLAYERS_FILE)) return [];
  return JSON.parse(fs.readFileSync(PLAYERS_FILE));
}

function writePlayers(players) {
  fs.writeFileSync(PLAYERS_FILE, JSON.stringify(players, null, 2));
}

function readMatches() {
  if (!fs.existsSync(MATCHES_FILE)) return [];
  return JSON.parse(fs.readFileSync(MATCHES_FILE));
}

function writeMatches(matches) {
  fs.writeFileSync(MATCHES_FILE, JSON.stringify(matches, null, 2));
}

// --- Rutas de leaderboard/frontend ---
// Leaderboard
app.get("/leaderboard", (req, res) => {
  const players = readPlayers();

  // Calcula stats para frontend si no existen
  const leaderboard = players.map(p => ({
    name: p.name,
    tag: p.tag,
    avgACS: p.avgACS ?? 0,
    avgKDA: p.kda ?? 0,
    hsPercent: p.hsPercent ?? 0,
    avgFirstBloods: p.avgFirstBloods ?? 0,
    winrate: p.winrate ?? 0,
    score: p.score ?? 0
  }));

  leaderboard.sort((a, b) => b.score - a.score);

  res.json(leaderboard);
});

// Rutas compatibles con frontend antiguo
app.get("/players", (req, res) => {
  const players = readPlayers();
  res.json(players);
});

app.post("/players", (req, res) => {
  const { name, tag } = req.body;
  if (!name || !tag) return res.status(400).json({ error: "Faltan datos" });

  const players = readPlayers();
  const newPlayer = { id: Date.now(), name, tag, kda: 0 };
  players.push(newPlayer);
  writePlayers(players);

  res.json({ success: true, message: "Jugador agregado", player: newPlayer });
});

app.post("/matches", (req, res) => {
  const { match, winnerTeam } = req.body;
  if (!match || !winnerTeam) return res.status(400).json({ error: "Datos incompletos" });

  const matches = readMatches();
  matches.push({ id: Date.now(), match, winnerTeam, date: new Date() });
  writeMatches(matches);

  // Actualizar stats por jugador
  const players = readPlayers();
  match.forEach(pData => {
    const player = players.find(p => p.name === pData.name && p.tag === pData.tag);
    if (player) {
      // Acumulamos estadísticas
      player.kills = (player.kills || 0) + pData.kills;
      player.deaths = (player.deaths || 0) + pData.deaths;
      player.assists = (player.assists || 0) + pData.assists;
      player.avgKDA = (player.kills + player.assists) / Math.max(player.deaths, 1);
      player.avgACS = (player.avgACS || 0) + (pData.acs || 0);
      player.hsPercent = (player.hsPercent || 0) + (pData.hsPercent || 0);
      player.avgFirstBloods = (player.avgFirstBloods || 0) + (pData.firstBloods || 0);
      player.winrate = ((player.winrate || 0) + (winnerTeam === (pData.team || "A") ? 100 : 0)) / 2;
      player.score = (player.avgKDA + player.avgACS + player.winrate) / 3; // ejemplo de score compuesto
    }
  });
  writePlayers(players);

  res.json({ success: true, message: "Partida registrada", data: req.body });
});

// --- Rutas admin ---
app.get("/admin/players", (req, res) => {
  const players = readPlayers();
  res.json(players);
});

app.post("/admin/add-player", (req, res) => {
  const { name, tag } = req.body;
  if (!name || !tag) return res.status(400).json({ error: "Faltan datos" });

  const players = readPlayers();
  const newPlayer = { id: Date.now(), name, tag, kda: 0 };
  players.push(newPlayer);
  writePlayers(players);

  res.json({ success: true, player: newPlayer });
});

app.put("/admin/edit-player/:id", (req, res) => {
  const { id } = req.params;
  const { name, kills, deaths, assists } = req.body;
  const players = readPlayers();
  const player = players.find(p => p.id == id);
  if (!player) return res.status(404).json({ error: "Jugador no encontrado" });

  if (name) player.name = name;
  if (kills != null) player.kills = Number(kills);
  if (deaths != null) player.deaths = Number(deaths);
  if (assists != null) player.assists = Number(assists);
  player.kda = (player.kills + player.assists) / Math.max(player.deaths, 1);

  writePlayers(players);
  res.json({ success: true, player });
});

app.delete("/admin/delete-player/:id", (req, res) => {
  let players = readPlayers();
  const initialLength = players.length;
  players = players.filter(p => p.id != req.params.id);

  if (players.length === initialLength)
    return res.status(404).json({ error: "Jugador no encontrado" });

  writePlayers(players);
  res.json({ success: true });
});

// --- Login admin ---
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  const ADMIN_USER = "admin";
  const ADMIN_PASS = "1234"; // Cambia esta credencial
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    res.json({ success: true });
  } else {
    res.status(401).json({ error: "Credenciales incorrectas" });
  }
});

// --- Ruta raíz de prueba ---
app.get("/", (req, res) => {
  res.json({ message: "Backend activo. Usa /leaderboard, /players o rutas admin" });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
