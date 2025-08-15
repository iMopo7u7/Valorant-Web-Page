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

// Configuración de middleware
app.use(cors({
  origin: 'http://localhost', // Ajusta según tu frontend
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuración de sesiones
app.use(session({
  secret: process.env.SESSION_SECRET || "clave-secreta-admin",
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false, // Cambiar a true en producción con HTTPS
    maxAge: 24 * 60 * 60 * 1000 // 1 día
  }
}));

// --- CONFIGURACIÓN ADMIN ---
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "1234";

// --- CONEXIÓN A MONGODB ---
let db, playersCollection, matchesCollection;

async function connectDB() {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI no está definido en .env");
    }

    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    db = client.db("valorantDB");
    playersCollection = db.collection("players");
    matchesCollection = db.collection("matches");
    
    // Crear índices para mejor rendimiento
    await playersCollection.createIndex({ name: 1, tag: 1 }, { unique: true });
    await matchesCollection.createIndex({ "match.name": 1, "match.tag": 1 });
    
    console.log("✅ Conectado a MongoDB");
  } catch (err) {
    console.error("❌ Error conectando a MongoDB:", err);
    process.exit(1);
  }
}

// --- MIDDLEWARE DE AUTENTICACIÓN ---
function authMiddleware(req, res, next) {
  if (req.session.user) return next();
  res.status(401).json({ error: "No autorizado" });
}

// --- RUTAS DE AUTENTICACIÓN ---
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.user = username;
    return res.json({ success: true });
  }
  res.status(401).json({ error: "Credenciales inválidas" });
});

app.get("/api/logout", (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: "Error al cerrar sesión" });
    res.json({ success: true });
  });
});

app.get("/api/check-auth", (req, res) => {
  res.json({ authenticated: !!req.session.user });
});

// --- RUTAS DEL DASHBOARD ---
app.get("/api/dashboard/stats", async (req, res) => {
  try {
    const [totalPlayers, totalMatches] = await Promise.all([
      playersCollection.countDocuments(),
      matchesCollection.countDocuments()
    ]);
    
    res.json({
      totalPlayers,
      totalMatches,
      activeEvents: 23, // Placeholder
      completedTournaments: 156 // Placeholder
    });
  } catch (err) {
    console.error("Error en /api/dashboard/stats:", err);
    res.status(500).json({ error: "Error al obtener estadísticas" });
  }
});

// --- RUTAS DE JUGADORES ---
app.get("/api/players", async (req, res) => {
  try {
    const { search, status } = req.query;
    const query = {};
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { tag: { $regex: search, $options: "i" } }
      ];
    }
    
    if (status) query.status = status;
    
    const players = await playersCollection.find(query).toArray();
    res.json(players);
  } catch (err) {
    console.error("Error en /api/players:", err);
    res.status(500).json({ error: "Error al obtener jugadores" });
  }
});

app.post("/api/players", authMiddleware, async (req, res) => {
  try {
    const { name, tag } = req.body;
    
    if (!name || !tag) {
      return res.status(400).json({ error: "Nombre y tag son requeridos" });
    }

    // Verificar si el jugador ya existe
    const existingPlayer = await playersCollection.findOne({
      $or: [
        { name: { $regex: `^${name}$`, $options: "i" } },
        { tag: { $regex: `^${tag}$`, $options: "i" } }
      ]
    });

    if (existingPlayer) {
      return res.status(400).json({ 
        error: existingPlayer.name === name ? 
          "El nombre ya está en uso" : "El tag ya está en uso"
      });
    }

    // Crear nuevo jugador
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
      status: "active",
      createdAt: new Date()
    };

    await playersCollection.insertOne(newPlayer);
    res.json(newPlayer);
  } catch (err) {
    console.error("Error en POST /api/players:", err);
    res.status(500).json({ error: "Error al crear jugador" });
  }
});

app.delete("/api/players/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Convertir id a ObjectId si usas IDs de MongoDB
    const result = await playersCollection.deleteOne({ 
      $or: [
        { _id: id }, // Si usas MongoDB ObjectId
        { name: id }, // O por nombre
        { tag: id }   // O por tag
      ]
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Jugador no encontrado" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Error en DELETE /api/players:", err);
    res.status(500).json({ error: "Error al eliminar jugador" });
  }
});

// --- RUTAS DE PARTIDAS (Placeholder) ---
app.get("/api/matches", (req, res) => {
  res.json({
    message: "Módulo de partidas en desarrollo",
    matches: []
  });
});

// --- RUTAS DE EVENTOS (Placeholder) ---
app.get("/api/events", (req, res) => {
  res.json([
    {
      id: 1,
      name: "Torneo de Ejemplo",
      type: "5v5",
      status: "upcoming",
      date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      participants: 0
    }
  ]);
});

// --- RUTAS DE CONFIGURACIÓN (Placeholder) ---
app.get("/api/settings", (req, res) => {
  res.json({
    systemName: "Valorant Admin Panel",
    region: "Latinoamérica",
    language: "Español",
    timezone: "GMT-5"
  });
});

// --- SERVIR ARCHIVOS ESTÁTICOS ---
app.use(express.static(path.join(__dirname, "../frontend")));

// Manejo de errores
app.use((err, req, res, next) => {
  console.error("Error global:", err);
  res.status(500).json({ error: "Error interno del servidor" });
});

// Iniciar servidor
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error("❌ Error al iniciar servidor:", err);
  process.exit(1);
});
