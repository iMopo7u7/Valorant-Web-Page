import express from "express";
import { playersCollection, matchesCollection } from "../db/db.js";
import { requireAdmin } from "../middleware/auth.js";

const router = express.Router();

// Añadir partida
router.post("/", requireAdmin, async (req, res) => {
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
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al añadir partida" });
  }
});

// Leaderboard público
router.get("/leaderboard", async (req, res) => {
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
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al generar leaderboard" });
  }
});

// Historial de un jugador
router.get("/:name/:tag", async (req, res) => {
  try {
    const { name, tag } = req.params;
    const matches = await matchesCollection.find({ match: { $elemMatch: { name, tag } } }).toArray();
    res.json(matches);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener historial" });
  }
});

// Contador de partidas
router.get("/count", async (req, res) => {
  try {
    const count = await matchesCollection.countDocuments();
    res.json({ count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener total de partidas" });
  }
});

export default router;
import express from "express";
import { playersCollection, matchesCollection } from "../db/db.js";
import { requireAdmin } from "../middleware/auth.js";

const router = express.Router();

// Añadir partida
router.post("/", requireAdmin, async (req, res) => {
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
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al añadir partida" });
  }
});

// Leaderboard público
router.get("/leaderboard", async (req, res) => {
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
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al generar leaderboard" });
  }
});

// Historial de un jugador
router.get("/:name/:tag", async (req, res) => {
  try {
    const { name, tag } = req.params;
    const matches = await matchesCollection.find({ match: { $elemMatch: { name, tag } } }).toArray();
    res.json(matches);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener historial" });
  }
});

// Contador de partidas
router.get("/count", async (req, res) => {
  try {
    const count = await matchesCollection.countDocuments();
    res.json({ count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener total de partidas" });
  }
});

export default router;
