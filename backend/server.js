import express from "express";
import cors from "cors";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const playersFile = path.join(__dirname, "players.json");
const matchesFile = path.join(__dirname, "matches.json");

app.use(cors());
app.use(express.json());

// Leer archivo JSON o devolver array vacío si no existe
async function readJSON(file) {
  try {
    const data = await fs.readFile(file, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

// Guardar JSON
async function writeJSON(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf-8");
}

// POST /players Añadir jugador (nombre + tag únicos)
app.post("/players", async (req, res) => {
  const { name, tag } = req.body;
  if (
    !name ||
    !tag ||
    typeof name !== "string" ||
    typeof tag !== "string" ||
    name.trim() === "" ||
    tag.trim() === ""
  ) {
    return res.status(400).json({ error: "Nombre y tag válidos son requeridos" });
  }

  const players = await readJSON(playersFile);

  const exists = players.find(
    (p) => p.name.toLowerCase() === name.toLowerCase() && p.tag.toLowerCase() === tag.toLowerCase()
  );

  if (exists) {
    return res.status(400).json({ error: "Jugador con ese nombre y tag ya existe" });
  }

  // Añadir jugador con stats acumuladas en 0
  players.push({
    name,
    tag,
    totalKills: 0,
    totalDeaths: 0,
    totalAssists: 0,
    totalACS: 0,
    totalFirstBloods: 0,
    matchesPlayed: 0,
  });

  await writeJSON(playersFile, players);
  res.json({ message: "Jugador añadido exitosamente" });
});

// GET /players Listar jugadores
app.get("/players", async (req, res) => {
  const players = await readJSON(playersFile);
  res.json(players);
});

// POST /matches Añadir partida con stats por jugador
app.post("/matches", async (req, res) => {
  const { match } = req.body;

  if (!Array.isArray(match) || match.length !== 10) {
    return res.status(400).json({ error: "Debes enviar un array de 10 jugadores" });
  }

  const players = await readJSON(playersFile);
  const matches = await readJSON(matchesFile);

  // Validar jugadores existentes y sin repetidos
  const seenPlayers = new Set();

  for (const p of match) {
    if (
      !p.name ||
      !p.tag ||
      typeof p.name !== "string" ||
      typeof p.tag !== "string" ||
      p.name.trim() === "" ||
      p.tag.trim() === ""
    ) {
      return res.status(400).json({ error: "Cada jugador debe tener nombre y tag válidos" });
    }
    const exists = players.find(
      (pl) =>
        pl.name.toLowerCase() === p.name.toLowerCase() &&
        pl.tag.toLowerCase() === p.tag.toLowerCase()
    );
    if (!exists) {
      return res.status(400).json({ error: `Jugador no encontrado: ${p.name}#${p.tag}` });
    }
    const key = `${p.name.toLowerCase()}#${p.tag.toLowerCase()}`;
    if (seenPlayers.has(key)) {
      return res.status(400).json({ error: `Jugador repetido en la partida: ${p.name}#${p.tag}` });
    }
    seenPlayers.add(key);

    // Validar stats numéricas
    const { kills, deaths, assists, acs, firstBloods } = p;
    if (
      [kills, deaths, assists, acs, firstBloods].some(
        (v) => typeof v !== "number" || isNaN(v) || v < 0
      )
    ) {
      return res.status(400).json({ error: `Stats inválidas para ${p.name}#${p.tag}` });
    }
  }

  // Guardar partida (match)
  matches.push(match);
  await writeJSON(matchesFile, matches);

  // Actualizar estadísticas acumuladas en players.json
  // Buscamos cada jugador y sumamos kills, deaths, assists, ACS, firstBloods, incrementamos matchesPlayed
  for (const p of match) {
    const player = players.find(
      (pl) =>
        pl.name.toLowerCase() === p.name.toLowerCase() &&
        pl.tag.toLowerCase() === p.tag.toLowerCase()
    );
    if (player) {
      player.totalKills += p.kills;
      player.totalDeaths += p.deaths;
      player.totalAssists += p.assists;
      player.totalACS += p.acs;
      player.totalFirstBloods += p.firstBloods;
      player.matchesPlayed += 1;
    }
  }

  await writeJSON(playersFile, players);

  res.json({ message: "Partida añadida exitosamente" });
});

// GET /leaderboard Devuelve lista ordenada por score compuesto
app.get("/leaderboard", async (req, res) => {
  const players = await readJSON(playersFile);

  // Calcular promedios y score compuesto (puedes ajustar fórmula)
  // Ejemplo fórmula score: promedio ACS + promedio KDA + promedio First Bloods * 10 (para ponderar)

  const withScores = players.map((p) => {
    const avgKills = p.matchesPlayed ? p.totalKills / p.matchesPlayed : 0;
    const avgDeaths = p.matchesPlayed ? p.totalDeaths / p.matchesPlayed : 1; // evitar div por 0
    const avgAssists = p.matchesPlayed ? p.totalAssists / p.matchesPlayed : 0;
    const avgACS = p.matchesPlayed ? p.totalACS / p.matchesPlayed : 0;
    const avgFirstBloods = p.matchesPlayed ? p.totalFirstBloods / p.matchesPlayed : 0;
    const avgKDA = avgDeaths === 0 ? avgKills : avgKills / avgDeaths;

    // Fórmula ejemplo para score compuesto:
    // Escalar First Bloods por 10 para darle peso (ajustable)
    const score = avgACS + avgKDA + avgFirstBloods * 10;

    return {
      name: p.name,
      tag: p.tag,
      avgKills,
      avgDeaths,
      avgAssists,
      avgACS,
      avgFirstBloods,
      avgKDA,
      matchesPlayed: p.matchesPlayed,
      score,
    };
  });

  // Orden descendente por score
  withScores.sort((a, b) => b.score - a.score);

  res.json(withScores);
});

// GET /matches/:name/:tag Obtener historial de partidas de un jugador
app.get("/matches/:name/:tag", async (req, res) => {
  const { name, tag } = req.params;
  const matches = await readJSON(matchesFile);

  // Filtrar partidas donde haya jugado ese jugador
  const filteredMatches = matches.filter((match) =>
    match.some(
      (p) =>
        p.name.toLowerCase() === name.toLowerCase() &&
        p.tag.toLowerCase() === tag.toLowerCase()
    )
  );

  res.json(filteredMatches);
});

app.listen(PORT, () => {
  console.log(`Servidor backend corriendo en http://localhost:${PORT}`);
});
