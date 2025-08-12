import express from "express";
import cors from "cors";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

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

// -------------------- RUTAS --------------------

// Añadir jugador
app.post("/players", async (req, res) => {
  try {
    const { name, tag } = req.body;
    if (!name || !tag || typeof name !== "string" || typeof tag !== "string") {
      return res.status(400).json({ error: "Nombre y tag válidos son requeridos" });
    }

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
  } catch (err) {
    res.status(500).json({ error: "Error interno al añadir jugador" });
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
    const { match } = req.body;
    if (!Array.isArray(match) || match.length !== 10) {
      return res.status(400).json({ error: "Debes enviar un array de 10 jugadores" });
    }

    const seenPlayers = new Set();
    for (const p of match) {
      if (!p.name || !p.tag) {
        return res.status(400).json({ error: "Cada jugador debe tener nombre y tag" });
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
        return res.status(400).json({ error: `Jugador repetido: ${p.name}#${p.tag}` });
      }
      seenPlayers.add(key);

      const { kills, deaths, assists, acs, firstBloods } = p;
      if ([kills, deaths, assists, acs, firstBloods].some(v => typeof v !== "number" || v < 0)) {
        return res.status(400).json({ error: `Stats inválidas para ${p.name}#${p.tag}` });
      }
    }

    await matchesCollection.insertOne({ match });
    for (const p of match) {
      await playersCollection.updateOne(
        { name: { $regex: `^${p.name.trim()}$`, $options: "i" }, tag: { $regex: `^${p.tag.trim()}$`, $options: "i" } },
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
  } catch {
    res.status(500).json({ error: "Error interno al añadir partida" });
  }
});

// Leaderboard con score ponderado y normalizado
app.get("/leaderboard", async (req, res) => {
  try {
    const players = await playersCollection.find().toArray();

    // Calcular promedios
    const playersWithAverages = players.map((p) => {
      const avgKills = p.matchesPlayed ? p.totalKills / p.matchesPlayed : 0;
      const avgDeaths = p.matchesPlayed ? p.totalDeaths / p.matchesPlayed : 1;
      const avgAssists = p.matchesPlayed ? p.totalAssists / p.matchesPlayed : 0;
      const avgACS = p.matchesPlayed ? p.totalACS / p.matchesPlayed : 0;
      const avgFirstBloods = p.matchesPlayed ? p.totalFirstBloods / p.matchesPlayed : 0;
      const avgKDA = avgDeaths === 0 ? (avgKills + avgAssists) : (avgKills + avgAssists) / avgDeaths;

      return { ...p, avgKills, avgDeaths, avgAssists, avgACS, avgFirstBloods, avgKDA };
    });

    // Encontrar mínimos y máximos para normalizar KDA, ACS y First Bloods
    const maxKDA = Math.max(...playersWithAverages.map(p => p.avgKDA));
    const minKDA = Math.min(...playersWithAverages.map(p => p.avgKDA));
    const maxACS = Math.max(...playersWithAverages.map(p => p.avgACS));
    const minACS = Math.min(...playersWithAverages.map(p => p.avgACS));
    const maxFB = Math.max(...playersWithAverages.map(p => p.avgFirstBloods));
    const minFB = Math.min(...playersWithAverages.map(p => p.avgFirstBloods));

    // Función para normalizar entre 0 y 1
    function normalize(value, min, max) {
      if (max === min) return 1; // evitar división por cero si todos iguales
      return (value - min) / (max - min);
    }

    // Calcular score ponderado
    const withScores = playersWithAverages.map(p => {
      const normKDA = normalize(p.avgKDA, minKDA, maxKDA);
      const normACS = normalize(p.avgACS, minACS, maxACS);
      const normFB = normalize(p.avgFirstBloods, minFB, maxFB);

      // Ponderación: 45% KDA, 35% ACS, 20% First Bloods
      const score = (normKDA * 0.45) + (normACS * 0.35) + (normFB * 0.20);

      return { ...p, score };
    });

    withScores.sort((a, b) => b.score - a.score);

    res.json(withScores);
  } catch {
    res.status(500).json({ error: "Error al generar leaderboard" });
  }
});

// Historial de partidas de un jugador
app.get("/matches/:name/:tag", async (req, res) => {
  try {
    const { name, tag } = req.params;
    const matches = await matchesCollection.find({
      match: { $elemMatch: { name: { $regex: `^${name}$`, $options: "i" }, tag: { $regex: `^${tag}$`, $options: "i" } } }
    }).toArray();
    res.json(matches);
  } catch {
    res.status(500).json({ error: "Error al obtener historial" });
  }
});

// -------------------- ARRANQUE --------------------
connectDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));
});
