import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import session from "express-session";
import MongoStore from "connect-mongo";
import path from "path";
import { fileURLToPath } from "url";

import { connectDB } from "./db/db.js";
import authRoutes from "./routes/auth.js";
import playersRoutes from "./routes/players.js";
import matchesRoutes from "./routes/matches.js";
import { requireAdmin } from "./middleware/auth.js";

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware ---
app.use(cors({
  origin: "https://valorant-10-mans-frontend.onrender.com",
  credentials: true,
}));
app.use(express.json());

// --- Sesiones ---
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

// --- Rutas estáticas frontend ---
app.use(express.static(path.join(__dirname, "../frontend")));
app.use("/private", express.static(path.join(__dirname, "private")));

// --- Rutas ---
app.use("/auth", authRoutes);
app.use("/players", playersRoutes);
app.use("/matches", matchesRoutes);

// --- Iniciar servidor ---
connectDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));
});
