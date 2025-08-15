import express from "express";
import cors from "cors";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuración básica
app.use(cors({
  origin: 'http://localhost', // Ajusta esto a tu URL de frontend
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuración de sesión
app.use(session({
  secret: process.env.SESSION_SECRET || "clave-secreta-temporal",
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

// Credenciales de administrador
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "1234";

// Conexión a MongoDB
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
    console.error("❌ Error de conexión a MongoDB:", err);
    process.exit(1);
  }
}

// Middleware de autenticación
function authMiddleware(req, res, next) {
  if (req.session.user) return next();
  res.status(401).json({ error: "Acceso no autorizado" });
}

// --- RUTAS PRINCIPALES ---

// Autenticación
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.user = username;
    return res.json({ success: true });
  }
  res.status(401).json({ error: "Credenciales incorrectas" });
});

app.get("/api/logout", (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: "Error al cerrar sesión" });
    res.json({ success: true });
  });
});

// Dashboard
app.get("/api/dashboard/stats", async (req, res) => {
  try {
    const [totalPlayers, totalMatches] = await Promise.all([
      playersCollection.countDocuments(),
      matchesCollection.countDocuments()
    ]);
    
    res.json({
      totalPlayers,
      totalMatches,
      activeEvents: 0, // Placeholder fijo
      completedTournaments: 0 // Placeholder fijo
    });
  } catch (err) {
    console.error("Error en estadísticas:", err);
    res.status(500).json({ error: "Error al obtener estadísticas" });
  }
});

// Jugadores
app.get("/api/players", async (req, res) => {
  try {
    const { search } = req.query;
    const query = search ? {
      $or: [
        { name: { $regex: search, $options: "i" } },
        { tag: { $regex: search, $options: "i" } }
      ]
    } : {};
    
    const players = await playersCollection.find(query).toArray();
    res.json(players);
  } catch (err) {
    console.error("Error obteniendo jugadores:", err);
    res.status(500).json({ error: "Error al obtener jugadores" });
  }
});

app.post("/api/players", authMiddleware, async (req, res) => {
  try {
    const { name, tag } = req.body;
    
    if (!name || !tag) {
      return res.status(400).json({ error: "Nombre y tag son requeridos" });
    }

    const existingPlayer = await playersCollection.findOne({
      $or: [
        { name: { $regex: `^${name}$`, $options: "i" } },
        { tag: { $regex: `^${tag}$`, $options: "i" } }
      ]
    });

    if (existingPlayer) {
      return res.status(400).json({ 
        error: "El jugador ya existe" 
      });
    }

    const newPlayer = {
      name: name.trim(),
      tag: tag.trim(),
      matchesPlayed: 0,
      createdAt: new Date()
    };

    await playersCollection.insertOne(newPlayer);
    res.status(201).json(newPlayer);
  } catch (err) {
    console.error("Error creando jugador:", err);
    res.status(500).json({ error: "Error al crear jugador" });
  }
});

app.delete("/api/players/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await playersCollection.deleteOne({ 
      $or: [
        { _id: id },
        { name: id },
        { tag: id }
      ]
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Jugador no encontrado" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Error eliminando jugador:", err);
    res.status(500).json({ error: "Error al eliminar jugador" });
  }
});

// Partidas (solo endpoint básico)
app.post("/api/matches", authMiddleware, async (req, res) => {
  res.status(501).json({ error: "Módulo en desarrollo" });
});

// Servir frontend
app.use(express.static(path.join(__dirname, "../frontend")));

// Iniciar servidor
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Servidor listo en http://localhost:${PORT}`);
  });
});
