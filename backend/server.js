import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// URL y cliente de MongoDB (pon tu URI en .env, ejemplo: MONGODB_URI=mongodb+srv://usuario:password@cluster.mongodb.net/dbname)
const mongoClient = new MongoClient(process.env.MONGODB_URI);
let db, playersCollection, matchesCollection;

async function connectDB() {
  await mongoClient.connect();
  db = mongoClient.db(); // base de datos default del URI
  playersCollection = db.collection("players");
  matchesCollection = db.collection("matches");
  console.log("Conectado a MongoDB");
}
connectDB().catch(console.error);

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

  // Revisar si existe jugador con mismo nombre y tag
  const exists = await playersCollection.findOne({
    name: { $regex: `^${name.trim()}$`, $options: "i" },
    tag: { $regex: `^${tag.trim()}$`, $options: "i" },
  });

  if (exists) {
    return res.status(400).json({ error: "Jugador con ese nombre y tag ya existe" });
  }

  const newPlayer = {
    name: name.trim(),
    tag: tag.trim(),
    totalKills: 0,
    totalDeaths: 0,
    totalAssists: 0,
    totalACS: 0,
    totalFirstBloods: 0,
    matchesPlayed: 0,
  };

  await playersCollection.insertOne(newPlayer);
  res.json({ message: "Jugador añadido exitosamente" });
});

// GET /players Listar jugadores
app.get("/players", async (req, res) => {
  const players = await playersCollection.find().toArray();
  res.json(players);
});

// POST /matches Añadir partida con stats por jugador
app.post("/matches", async (req, res) => {
  const { match } = req.body;

  if (!Array.isArray(match) || match.length !== 10) {
    return res.status(400).json({ error: "Debes enviar un array de 10 jugadores" });
  }

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

    const exists = await playersCollection.findOne({
      name: { $regex: `^${p.name.trim()}$`, $options: "i" },
      tag: { $regex: `^${p.tag.trim()}$`, $options: "i" },
    });

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

  // Guardar partida
  await matchesCollection.insertOne({ match });

  // Actualizar estadísticas acumuladas de cada jugador
  for (const p of match) {
    await playersCollection.updateOne(
      {
        name: { $regex: `^${p.name.trim()}$`, $options: "i" },
        tag: { $regex: `^${p.tag.trim()}$`, $options: "i" },
      },
      {
        $inc: {
          totalKills: p.kills,
          totalDeaths: p.deaths,
          totalAssists: p.assists,
          totalACS: p.acs,
          totalFirstBloods: p.firstBloods,
          matchesPlayed: 1,
        },
      }
    );
  }

  res.json({ message: "Partida añadida exitosamente" });
});

// GET /leaderboard Devuelve lista ordenada por score compuesto
app.get("/leaderboard", async (req, res) => {
  const players = await playersCollection.find().toArray();

  const withScores = players.map((p) => {
    const avgKills = p.matchesPlayed ? p.totalKills / p.matchesPlayed : 0;
    const avgDeaths = p.matchesPlayed ? p.totalDeaths / p.matchesPlayed : 1; // evitar div por 0
    const avgAssists = p.matchesPlayed ? p.totalAssists / p.matchesPlayed : 0;
    const avgACS = p.matchesPlayed ? p.totalACS / p.matchesPlayed : 0;
    const avgFirstBloods = p.matchesPlayed ? p.totalFirstBloods / p.matchesPlayed : 0;
    const avgKDA = avgDeaths === 0 ? avgKills : avgKills / avgDeaths;

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

  withScores.sort((a, b) => b.score - a.score);

  res.json(withScores);
});

// GET /matches/:name/:tag Obtener historial de partidas de un jugador
app.get("/matches/:name/:tag", async (req, res) => {
  const { name, tag } = req.params;
  const matches = await matchesCollection.find().toArray();

  const filteredMatches = matches.filter((m) =>
    m.match.some(
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
