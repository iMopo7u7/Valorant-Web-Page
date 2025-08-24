// routes/admin.js
import express from "express";
const router = express.Router();

export default function(sessionMiddleware, playersCollection) {

  function requireAdmin(req, res, next) {
    if (req.session.isAdmin) next();
    else res.status(403).json({ error: "Acceso denegado" });
  }

  // --- Login
  router.post("/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      const ADMIN_USER = process.env.ADMIN_USER || "admin";
      const ADMIN_PASS = process.env.ADMIN_PASS || "1234";

      if (username === ADMIN_USER && password === ADMIN_PASS) {
        req.session.isAdmin = true;
        res.json({ success: true });
      } else {
        res.status(401).json({ error: "Usuario o contraseña incorrectos" });
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error interno en login" });
    }
  });

  // --- Check session
  router.get("/check-session", requireAdmin, (req, res) => {
    res.json({ loggedIn: !!req.session.isAdmin });
  });

  // --- Logout
  router.post("/logout", requireAdmin, (req, res) => {
    req.session.destroy(err => {
      if(err) return res.status(500).json({error:"Error cerrando sesión"});
      res.clearCookie("connect.sid");
      res.json({success:true});
    });
  });

  // --- CRUD Players
  router.post("/players", requireAdmin, async (req, res) => {
    try {
      const { name, tag, badges = [], social = {} } = req.body;
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
        badges,
        social
      };

      await playersCollection.insertOne(newPlayer);
      res.json({ message: "Jugador añadido exitosamente" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error al añadir jugador" });
    }
  });

  router.put("/players", requireAdmin, async (req, res) => {
    try {
      const { oldName, oldTag, newName, newTag, social } = req.body;
      if (!oldName || !oldTag || !newName || !newTag)
        return res.status(400).json({ error: "Todos los campos son requeridos" });

      await playersCollection.updateOne(
        { name: oldName, tag: oldTag },
        { $set: { name: newName, tag: newTag, social: social || {} } }
      );

      res.json({ message: "Jugador actualizado correctamente" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error al actualizar jugador" });
    }
  });

  router.delete("/players", requireAdmin, async (req, res) => {
    try {
      const { name, tag } = req.body;
      if (!name || !tag) return res.status(400).json({ error: "Nombre y tag requeridos" });

      await playersCollection.deleteOne({ name, tag });
      res.json({ message: "Jugador eliminado correctamente" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error al eliminar jugador" });
    }
  });

  return router;
}
