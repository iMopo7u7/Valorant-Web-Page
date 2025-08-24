// routes/events.js
import express from "express";
import { ObjectId } from "mongodb";
const router = express.Router();

export default function(eventsCollection) {

  function requireAdmin(req, res, next) {
    if (req.session.isAdmin) next();
    else res.status(403).json({ error: "Acceso denegado" });
  }

  // --- CRUD Events
  router.post("/events", requireAdmin, async (req, res) => {
    try {
      const { name, teamSize, numTeams, rounds = 0, teams = {}, badge } = req.body;
      if (!name || !teamSize || !numTeams)
        return res.status(400).json({ error: "Completa todos los campos" });

      const exists = await eventsCollection.findOne({ name });
      if (exists) return res.status(400).json({ error: "Evento ya existe" });

      const newEvent = {
        name,
        teamSize,
        numTeams,
        rounds,
        matches: [],
        teams,       
        badge,       
        createdAt: new Date()
      };

      await eventsCollection.insertOne(newEvent);
      res.json({ message: "Evento creado correctamente" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error al crear evento" });
    }
  });

  router.get("/events", requireAdmin, async (req, res) => {
    try {
      const events = await eventsCollection.find().sort({ createdAt: -1 }).toArray();
      res.json(events);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error al obtener eventos" });
    }
  });

  router.get("/events/:id/matches", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const event = await eventsCollection.findOne({ _id: new ObjectId(id) });
      if (!event) return res.status(404).json({ error: "Evento no encontrado" });
      res.json(event.matches || []);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error al obtener partidas del evento" });
    }
  });

  router.post("/events/:id/matches", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { map, winnerTeam, score, teamA, teamB } = req.body;
      if (!map || !winnerTeam || !score) return res.status(400).json({ error: "Completa mapa, ganador y marcador" });

      const event = await eventsCollection.findOne({ _id: new ObjectId(id) });
      if (!event) return res.status(404).json({ error: "Evento no encontrado" });

      const newMatch = { map, winnerTeam, score, teamA, teamB, date: new Date() };
      await eventsCollection.updateOne({ _id: new ObjectId(id) }, { $push: { matches: newMatch } });

      res.json({ message: "Partida añadida al evento correctamente" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error al añadir partida" });
    }
  });

  return router;
}
