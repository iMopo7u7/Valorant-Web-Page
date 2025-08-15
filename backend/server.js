// server.js en ES Modules
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const PORT = process.env.PORT || 3000;

// __dirname en ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public"))); // si tienes frontend en /public

// Archivo de datos
const DATA_FILE = path.join(__dirname, "players.json");

// Funciones de manejo de datos
function readPlayers() {
  if (!fs.existsSync(DATA_FILE)) return [];
  const data = fs.readFileSync(DATA_FILE);
  return JSON.parse(data);
}

function writePlayers(players) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(players, null, 2));
}

// --- Rutas públicas ---
app.get("/leaderboard", (req, res) => {
  const players = readPlayers();
  players.sort((a, b) => (b.kda || 0) - (a.kda || 0));
  res.json(players);
});

// --- Rutas admin ---
app.get("/admin/players", (req, res) => {
  const players = readPlayers();
  res.json(players);
});

app.post("/admin/add-player", (req, res) => {
  const { name, kills, deaths, assists } = req.body;
  if (!name || kills == null || deaths == null || assists == null) {
    return res.status(400).json({ error: "Faltan datos del jugador" });
  }

  const players = readPlayers();
  const newPlayer = {
    id: Date.now(),
    name,
    kills: Number(kills),
    deaths: Number(deaths),
    assists: Number(assists),
    kda: (Number(kills) + Number(assists)) / Math.max(Number(deaths), 1),
  };
  players.push(newPlayer);
  writePlayers(players);

  res.json({ success: true, player: newPlayer });
});

app.put("/admin/edit-player/:id", (req, res) => {
  const { id } = req.params;
  const { name, kills, deaths, assists } = req.body;
  const players = readPlayers();
  const player = players.find((p) => p.id == id);
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
  const { id } = req.params;
  let players = readPlayers();
  const initialLength = players.length;
  players = players.filter((p) => p.id != id);

  if (players.length === initialLength)
    return res.status(404).json({ error: "Jugador no encontrado" });

  writePlayers(players);
  res.json({ success: true });
});

// Servidor
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
