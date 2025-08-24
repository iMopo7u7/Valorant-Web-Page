import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv";
import session from "express-session";
import MongoStore from "connect-mongo";
import path from "path";
import { fileURLToPath } from "url";

// Importar rutas modulares
import leaderboardRoutesFunc from "./routes/leaderboard.js";
import adminRoutesFunc from "./routes/admin.js";
import eventsRoutesFunc from "./routes/events.js";

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

    // -------------------
    // --- Montar rutas
    // -------------------
    app.use("/", leaderboardRoutesFunc(playersCollection, eventsCollection));
    app.use("/", adminRoutesFunc(playersCollection, eventsCollection));
    app.use("/", eventsRoutesFunc(playersCollection, eventsCollection));

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
// --- Servidor
// -------------------
connectDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));
});
