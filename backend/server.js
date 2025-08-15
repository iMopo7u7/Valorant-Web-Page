import express from "express";
import cors from "cors";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors({
  origin: "https://valorant-10-mans-frontend.onrender.com",
  credentials: true
}));
app.use(express.json());

// --- Conexión MongoDB ---
if (!process.env.MONGODB_URI) {
  console.error("❌ ERROR: MONGODB_URI no está definido en las variables de entorno.");
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

// --- API ---
// Añadir jugador
app.post("/players", async (req, res) => {
  try {
    const { name, tag } = req.body;
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
    };

    await playersCollection.insertOne(newPlayer);
    res.json({ message: "Jugador añadido exitosamente" });
  } catch {
    res.status(500).json({ error: "Error al añadir jugador" });
  }
});

// Listar jugadores
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
    if (!Array.isArray(match) || match.length !== 10) return res.status(400).json({ error: "Formato inválido" });

    await matchesCollection.insertOne({ match, winnerTeam, date: new Date() });

    for (const p of match) {
      const playerTeam = match.indexOf(p) < 5 ? "A" : "B";
      const headshotKills = Math.round((p.hsPercent / 100) * p.kills);

      await playersCollection.updateOne(
        { name: p.name, tag: p.tag },
        {
          $inc: {
            totalKills: p.kills,
            totalDeaths: p.deaths,
            totalAssists: p.assists,
            totalACS: p.acs,
            totalFirstBloods: p.firstBloods,
            totalHeadshotKills: headshotKills,
            matchesPlayed: 1,
            wins: playerTeam === winnerTeam ? 1 : 0,
          },
        }
      );
    }

    res.json({ message: "Partida añadida exitosamente" });
  } catch {
    res.status(500).json({ error: "Error al añadir partida" });
  }
});

// Leaderboard
app.get("/leaderboard", async (req, res) => {
  try {
    const players = await playersCollection.find().toArray();
    const withScores = players.map(p => {
      const matches = p.matchesPlayed || 0;
      const avgKills = matches ? p.totalKills / matches : 0;
      const avgDeaths = matches ? p.totalDeaths / matches : 1;
      const avgACS = matches ? p.totalACS / matches : 0;
      const avgFirstBloods = matches ? p.totalFirstBloods / matches : 0;
      const avgAssists = matches ? p.totalAssists / matches : 0;
      const winrate = matches ? (p.wins / matches) * 100 : 0;
      const hsPercent = p.totalKills ? (p.totalHeadshotKills / p.totalKills) * 100 : 0;

      const avgKDA = avgDeaths === 0 ? avgKills : avgKills / avgDeaths;
      const cappedKills = Math.min(avgKills, 30);
      const impactKillsScore = (avgFirstBloods * 1.5) + (cappedKills - avgFirstBloods);

      const scoreRaw = (avgACS * 1.5) + (impactKillsScore * 1.2) + (avgAssists * 0.8) + (hsPercent) + (winrate) - (avgDeaths);
      const reliabilityFactor = Math.min(matches / 5, 1);
      const consistencyBonus = 1 + (Math.min(matches, 20) / 100);

      return { name: p.name, tag: p.tag, avgKills, avgDeaths, avgACS, avgFirstBloods, avgAssists, hsPercent, winrate, avgKDA, score: scoreRaw * consistencyBonus * reliabilityFactor, matchesPlayed: matches };
    });

    withScores.sort((a, b) => b.score - a.score);
    res.json(withScores);
  } catch {
    res.status(500).json({ error: "Error al generar leaderboard" });
  }
});

// Historial de un jugador
app.get("/matches/:name/:tag", async (req, res) => {
  try {
    const { name, tag } = req.params;
    const matches = await matchesCollection.find({ match: { $elemMatch: { name, tag } } }).toArray();
    res.json(matches);
  } catch {
    res.status(500).json({ error: "Error al obtener historial" });
  }
});

// Iniciar servidor
connectDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));
});
