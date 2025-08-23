import express from "express";
import cors from "cors";
import { MongoClient } from "mongodb";
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

// --- Middleware CORS (solo tu frontend público) ---
const allowedOrigins = [
  "https://valorant-10-mans-frontend.onrender.com"
];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true); // requests desde Postman o server-side
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

app.use(express.json());

// --- Sesiones con MongoStore ---
const sessionStore = MongoStore.create({
  mongoUrl: process.env.MONGODB_URI,
  collectionName: "sessions",
  ttl: 60 * 60, // 1 hora
});

app.use(session({
  secret: process.env.SESSION_SECRET || "valorantsecret",
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: { maxAge: 60 * 60 * 1000 }
}));

// --- Conexión MongoDB ---
if (!process.env.MONGODB_URI) {
  console.error("❌ ERROR: MONGODB_URI no está definido.");
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

// --- Rutas estáticas frontend (solo lectura) ---
app.use(express.static(path.join(__dirname, "../frontend")));

// --- Login/admin (protegido) ---
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "1234";

app.get("/private/login.html", (req, res) => {
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

// Middleware de protección admin
function requireAdmin(req, res, next) {
  if (req.session.isAdmin) next();
  else res.status(403).json({ error: "Acceso denegado" });
}

app.get("/check-session", (req, res) => {
  res.json({ loggedIn: !!req.session.isAdmin });
});

app.post("/logout", (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: "Error cerrando sesión" });
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

app.get("/private/admin.html", requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "private/admin.html"));
});

// --- CRUD Players y Matches (requieren admin) ---
app.post("/players", requireAdmin, async (req, res) => {
  try {
    const { name, tag } = req.body;
    if (!name || !tag) return res.status(400).json({ error: "Nombre y tag requeridos" });
    const exists = await playersCollection.findOne({ name, tag });
    if (exists) return res.status(400).json({ error: "Jugador ya existe" });
    await playersCollection.insertOne({ name, tag, totalKills: 0, totalDeaths: 0, totalAssists: 0, matchesPlayed: 0 });
    res.json({ message: "Jugador añadido exitosamente" });
  } catch (err) { res.status(500).json({ error: "Error al añadir jugador" }); }
});

app.get("/players", requireAdmin, async (req, res) => {
  const players = await playersCollection.find().toArray();
  res.json(players);
});

app.put("/players", requireAdmin, async (req, res) => {
  const { oldName, oldTag, newName, newTag } = req.body;
  await playersCollection.updateOne({ name: oldName, tag: oldTag }, { $set: { name: newName, tag: newTag } });
  res.json({ message: "Jugador actualizado" });
});

app.delete("/players", requireAdmin, async (req, res) => {
  const { name, tag } = req.body;
  await playersCollection.deleteOne({ name, tag });
  res.json({ message: "Jugador eliminado" });
});

app.post("/matches", requireAdmin, async (req, res) => {
  const { match, winnerTeam, score } = req.body;
  await matchesCollection.insertOne({ match, winnerTeam, score, date: new Date() });
  res.json({ message: "Partida añadida" });
});

// --- Endpoints públicos (solo lectura) ---
app.get("/leaderboard", async (req, res) => {
  const players = await playersCollection.find().toArray();
  res.json(players);
});

app.get("/matches-count", async (req, res) => {
  const count = await matchesCollection.countDocuments();
  res.json({ count });
});

// --- Iniciar servidor ---
connectDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));
});
