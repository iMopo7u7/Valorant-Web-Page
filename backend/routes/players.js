import express from "express";
import { playersCollection, matchesCollection } from "../db/db.js";
import { requireAdmin } from "../middleware/auth.js";

const router = express.Router();

// Añadir jugador
router.post("/", requireAdmin, async (req, res) => {
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
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al añadir jugador" });
  }
});

// Listar jugadores
router.get("/", requireAdmin, async (req, res) => {
  try {
    const players = await playersCollection.find().toArray();
    res.json(players);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener jugadores" });
  }
});

// Editar jugador
router.put("/", requireAdmin, async (req, res) => {
  try {
    const { oldName, oldTag, newName, newTag } = req.body;
    if (!oldName || !oldTag || !newName || !newTag)
      return res.status(400).json({ error: "Todos los campos son requeridos" });

    await playersCollection.updateOne(
      { name: oldName, tag: oldTag },
      { $set: { name: newName, tag: newTag } }
    );

    const matches = await matchesCollection.find({ "match.name": oldName, "match.tag": oldTag }).toArray();
    for (const match of matches) {
      let modified = false;
      match.match.forEach(player => {
        if (player.name === oldName && player.tag === oldTag) {
          player.name = newName;
          player.tag = newTag;
          modified = true;
        }
      });
      if (modified) await matchesCollection.updateOne({ _id: match._id }, { $set: { match: match.match } });
    }

    res.json({ message: "Jugador actualizado correctamente en players y matches" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al actualizar jugador" });
  }
});

// Eliminar jugador
router.delete("/", requireAdmin, async (req, res) => {
  try {
    const { name, tag } = req.body;
    if (!name || !tag) return res.status(400).json({ error: "Nombre y tag requeridos" });

    await playersCollection.deleteOne({ name, tag });
    await matchesCollection.updateMany(
      { "match.name": name, "match.tag": tag },
      { $pull: { match: { name, tag } } }
    );

    res.json({ message: "Jugador eliminado correctamente" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al eliminar jugador" });
  }
});

export default router;
