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

    if (exists) return res.status(400).json({ error: "Jugador con ese nombre y tag ya existe" });

    const newPlayer = {
      name: name.trim(),
      tag: tag.trim(),
      totalKills: 0,
      totalDeaths: 0,
      totalAssists: 0,
      totalACS: 0,
      totalFirstBloods: 0,
      totalHeadshotKills: 0, // se sigue acumulando internamente
      matchesPlayed: 0,
      wins: 0,
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

// Añadir partida con HS% en lugar de headshotKills
app.post("/matches", async (req, res) => {
  try {
    const { match, winnerTeam } = req.body;

    if (!Array.isArray(match) || match.length !== 10)
      return res.status(400).json({ error: "Debes enviar un array de 10 jugadores" });

    if (!["A", "B"].includes(winnerTeam))
      return res.status(400).json({ error: "Debe indicar equipo ganador válido (A o B)" });

    const seenPlayers = new Set();

    for (const p of match) {
      const requiredNumbers = ["kills","deaths","assists","acs","firstBloods","hsPercent"];
      if (!p.name || !p.tag || requiredNumbers.some(n => typeof p[n] !== "number" || p[n] < 0) || p.hsPercent > 100) {
        return res.status(400).json({ error: `Datos inválidos para jugador ${p.name}#${p.tag}` });
      }

      const exists = await playersCollection.findOne({
        name: { $regex: `^${p.name.trim()}$`, $options: "i" },
        tag: { $regex: `^${p.tag.trim()}$`, $options: "i" },
      });

      if (!exists) return res.status(400).json({ error: `Jugador no encontrado: ${p.name}#${p.tag}` });

      const key = `${p.name.toLowerCase()}#${p.tag.toLowerCase()}`;
      if (seenPlayers.has(key)) return res.status(400).json({ error: `Jugador repetido: ${p.name}#${p.tag}` });
      seenPlayers.add(key);
    }

    // Guardar la partida
    await matchesCollection.insertOne({ match, winnerTeam, date: new Date() });

    // Actualizar estadísticas
    for (const p of match) {
      const playerTeam = match.indexOf(p) < 5 ? "A" : "B"; // asumiendo orden
      const headshotKills = Math.round((p.hsPercent / 100) * p.kills);

      await playersCollection.updateOne(
        { name: { $regex: `^${p.name.trim()}$`, $options: "i" }, tag: { $regex: `^${p.tag.trim()}$`, $options: "i" } },
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
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error interno al añadir partida" });
  }
});

// Leaderboard
app.get("/leaderboard", async (req, res) => {
  try {
    const players = await playersCollection.find().toArray();

    const withScores = players.map((p) => {
      const matches = p.matchesPlayed || 0;
      const avgKills = matches ? p.totalKills / matches : 0;
      const avgDeaths = matches ? p.totalDeaths / matches : 1;
      const avgACS = matches ? p.totalACS / matches : 0;
      const avgFirstBloods = matches ? p.totalFirstBloods / matches : 0;
      const avgAssists = matches ? p.totalAssists / matches : 0;
      const winrate = matches ? (p.wins / matches) * 100 : 0;
      const hsPercent = p.totalKills ? (p.totalHeadshotKills / p.totalKills) * 100 : 0;

      // KDA
      const avgKDA = avgDeaths === 0 ? avgKills : avgKills / avgDeaths;

      // Anti "farm kills": límite máximo de kills por partida para cálculo
      const cappedKills = Math.min(avgKills, 30);
      const impactKillsScore = (avgFirstBloods * 1.5) + (cappedKills - avgFirstBloods);

      // Ponderación de cada estadística
      const scoreRaw =
        (avgACS * 2.0) +
        (impactKillsScore * 1.5) +
        (avgAssists * 0.8) +
        (hsPercent * 1.2) +
        (winrate * 1.0) -
        (avgDeaths * 1.0);

      // Bonus por consistencia (jugadores que jugaron más)
      const consistencyBonus = 1 + (Math.min(matches, 20) / 100); // max 20% extra
      const finalScore = scoreRaw * consistencyBonus;

      return {
        name: p.name,
        tag: p.tag,
        avgKills,
        avgDeaths,
        avgACS,
        avgFirstBloods,
        avgAssists,
        hsPercent,
        winrate,
        avgKDA,
        score: finalScore,
        matchesPlayed: matches,
        totalFirstBloods: p.totalFirstBloods,
        wins: p.wins,
      };
    });

    // Ordenar de mayor a menor score
    withScores.sort((a, b) => b.score - a.score);

    res.json(withScores);
  } catch (err) {
    console.error("Error en leaderboard:", err);
    res.status(500).json({ error: "Error al generar leaderboard" });
  }
});

// Historial de partidas de un jugador
app.get("/matches/:name/:tag", async (req, res) => {
  try {
    const { name, tag } = req.params;
    const matches = await matchesCollection
      .find({
        match: {
          $elemMatch: {
            name: { $regex: `^${name}$`, $options: "i" },
            tag: { $regex: `^${tag}$`, $options: "i" },
          },
        },
      })
      .toArray();
    res.json(matches);
  } catch {
    res.status(500).json({ error: "Error al obtener historial" });
  }
});

connectDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));
});
