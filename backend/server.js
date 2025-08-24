import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv";
import session from "express-session";
import MongoStore from "connect-mongo";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// -------------------
// --- CORS
// -------------------
const allowedOrigins = [
  "https://valorant-10-mans-frontend.onrender.com",
  "https://valorant-10-mans.onrender.com"
];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("CORS policy error"), false);
  },
  credentials: true,
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));

app.options('*', cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));

// -------------------
// --- Body parser
// -------------------
app.use(express.json());

// -------------------
// --- Sesiones con MongoStore
// -------------------
const sessionStore = MongoStore.create({
  mongoUrl: process.env.MONGODB_URI,
  collectionName: "sessions",
  ttl: 60 * 60,
});

app.use(session({
  secret: process.env.SESSION_SECRET || "valorantsecret",
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: { maxAge: 60 * 60 * 1000 }
}));

// -------------------
// --- Conexión MongoDB
// -------------------
if (!process.env.MONGODB_URI) {
  console.error("❌ ERROR: MONGODB_URI no está definido.");
  process.exit(1);
}

let db, playersCollection, eventsCollection;
async function connectDB() {
  try {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    db = client.db("valorantDB");
    playersCollection = db.collection("players");
    eventsCollection = db.collection("events");
    console.log("✅ Conectado a MongoDB");
  } catch (err) {
    console.error("❌ Error conectando a MongoDB:", err);
    process.exit(1);
  }
}

// -------------------
// --- Rutas estáticas
// -------------------
app.use(express.static(path.join(__dirname, "../frontend")));
app.use("/private", express.static(path.join(__dirname, "private")));

// -------------------
// --- Login / Admin
// -------------------
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "1234";

app.get("/login.html", (req, res) => {
  res.sendFile(path.join(__dirname, "private/login.html"));
});

app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
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

function requireAdmin(req, res, next) {
  if (req.session.isAdmin) next();
  else res.status(403).json({ error: "Acceso denegado" });
}

app.get("/check-session", (req, res) => {
  res.json({ loggedIn: !!req.session.isAdmin });
});

// -------------------
// --- Rutas seguras de páginas
// -------------------
app.get("/admin.html", requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "private/admin.html"));
});

app.get("/events.html", requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "private/events.html"));
});

// -------------------
// --- CRUD Players 
// -------------------
app.post("/players", requireAdmin, async (req, res) => {
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

app.get("/players", requireAdmin, async (req, res) => {
  try {
    const players = await playersCollection.find().toArray();
    res.json(players);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener jugadores" });
  }
});

app.put("/players", requireAdmin, async (req, res) => {
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

app.delete("/players", requireAdmin, async (req, res) => {
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

// -------------------
// --- CRUD Events / Torneos
// -------------------

// Crear evento
app.post("/events", requireAdmin, async (req, res) => {
  try {
    const { name, teamSize, numTeams, badge } = req.body;
    if (!name || !teamSize || !numTeams) return res.status(400).json({ error: "Completa todos los campos" });

    const exists = await eventsCollection.findOne({ name });
    if (exists) return res.status(400).json({ error: "Evento ya existe" });

    const newEvent = {
      name,
      teamSize,
      numTeams,
      badge,
      matches: [],
      teams: [],
      createdAt: new Date()
    };

    const result = await eventsCollection.insertOne(newEvent);
    newEvent._id = result.insertedId;
    res.json(newEvent);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al crear evento" });
  }
});

// Listar eventos
app.get("/events", requireAdmin, async (req, res) => {
  try {
    const events = await eventsCollection.find().sort({ createdAt: -1 }).toArray();
    res.json(events);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener eventos" });
  }
});

// Eliminar evento
app.delete("/events/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await eventsCollection.deleteOne({ _id: new ObjectId(id) });
    res.json({ message: "Evento eliminado correctamente" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al eliminar evento" });
  }
});

// Actualizar equipos
app.put("/events/:id/teams", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const teams = req.body; // se espera un array de equipos
    await eventsCollection.updateOne({ _id: new ObjectId(id) }, { $set: { teams } });
    res.json({ message: "Equipos actualizados correctamente" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al actualizar equipos" });
  }
});

// Añadir nueva partida
app.post("/events/:id/matches", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const match = req.body; // map, winner, score, stats, team1Id, team2Id, round
    await eventsCollection.updateOne({ _id: new ObjectId(id) }, { $push: { matches: match } });
    res.json({ message: "Partida añadida correctamente" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al añadir partida" });
  }
});

// Actualizar partida existente
app.put("/events/:eventId/matches/:matchId", requireAdmin, async (req, res) => {
  try {
    const { eventId, matchId } = req.params;
    const matchData = req.body; // map, winner, score, stats

    const event = await eventsCollection.findOne({ _id: new ObjectId(eventId) });
    if (!event) return res.status(404).json({ error: "Evento no encontrado" });

    const matches = event.matches.map(m => {
      if (m._id?.toString() === matchId || m.id == matchData.id) {
        return { ...m, ...matchData, completed: true };
      }
      return m;
    });

    await eventsCollection.updateOne({ _id: new ObjectId(eventId) }, { $set: { matches } });
    res.json({ message: "Partida actualizada correctamente" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al actualizar partida" });
  }
});

// Obtener partidas de un evento
app.get("/events/:id/matches", requireAdmin, async (req, res) => {
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

// -------------------
// --- Logout
// -------------------
app.post("/logout", (req, res) => {
  req.session.destroy(err => {
    if(err) return res.status(500).json({error:"Error cerrando sesión"});
    res.clearCookie("connect.sid");
    res.json({success:true});
  });
});

// -------------------
// --- Iniciar servidor
// -------------------
connectDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));
});
