// routes/leaderboard.js
import express from "express";
const router = express.Router();

export default function(playersCollection, eventsCollection) {

  // /leaderboard → lista de jugadores con sus stats y score
  router.get("/", async (req, res) => {
    try {
      const players = await playersCollection.find().toArray();
      const withScores = players.map(p => {
        const matches = p.matchesPlayed || 0;
        const avgKills = matches ? p.totalKills / matches : 0;
        const avgDeaths = matches ? p.totalDeaths / matches : 1;
        const avgACS = matches ? p.totalACS / matches : 0;
        const avgAssists = matches ? p.totalAssists / matches : 0;
        const winrate = matches ? (p.wins / matches) * 100 : 0;
        const hsPercent = p.totalKills ? (p.totalHeadshotKills / p.totalKills) * 100 : 0;
        const avgKDA = avgDeaths === 0 ? avgKills : avgKills / avgDeaths;
        const cappedKills = Math.min(avgKills, 30);
        const impactKillsScore = (p.totalFirstBloods * 1.5) + (cappedKills - p.totalFirstBloods);
        const scoreRaw = (avgACS * 1.5) + (impactKillsScore * 1.2) + (avgAssists * 0.8) + hsPercent + winrate - avgDeaths;
        const reliabilityFactor = Math.min(matches / 5, 1);
        const consistencyBonus = 1 + (Math.min(matches, 20) / 100);

        return {
          name: p.name,
          tag: p.tag,
          avgACS,
          avgKDA,
          hsPercent,
          fk: matches ? (p.totalFirstBloods / matches) : 0,
          winrate,
          score: Math.round(scoreRaw * consistencyBonus * reliabilityFactor),
          matchesPlayed: matches,
          badges: p.badges || [],
          social: p.social || {}
        };
      });

      withScores.sort((a, b) => b.score - a.score);
      res.json(withScores);
    } catch(err) {
      console.error(err);
      res.status(500).json({ error: "Error al generar leaderboard" });
    }
  });

  // /players-count
  router.get("/players-count", async (req, res) => {
    try {
      const count = await playersCollection.countDocuments();
      res.json({ count });
    } catch(err) {
      console.error(err);
      res.status(500).json({ error: "Error obteniendo total de jugadores" });
    }
  });

  // /matches-count
  router.get("/matches-count", async (req, res) => {
    try {
      const events = await eventsCollection.find().toArray();
      const totalMatches = events.reduce((sum, e) => sum + (e.matches?.length || 0), 0);
      res.json({ count: totalMatches });
    } catch(err) {
      console.error(err);
      res.status(500).json({ error: "Error obteniendo total de partidas" });
    }
  });

  // /last-match
  router.get("/last-match", async (req, res) => {
    try {
      const lastEvent = await eventsCollection.find().sort({ createdAt: -1 }).limit(1).toArray();
      if (!lastEvent[0] || !lastEvent[0].matches?.length) return res.json({ date: null });
      const lastMatch = lastEvent[0].matches[lastEvent[0].matches.length - 1];
      res.json({ date: lastMatch.date || lastEvent[0].createdAt });
    } catch(err) {
      console.error(err);
      res.status(500).json({ error: "Error obteniendo última partida" });
    }
  });

  return router;
}
