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

// --- Middleware CORS actualizado ---
const allowedOrigins = [
  "https://valorant-10-mans-frontend.onrender.com", // producción
  "http://127.0.0.1:5500",                           // localhost
  "http://localhost:5500"
];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true); // para requests desde Postman o curl
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = "CORS policy error";
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true
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
  cookie: { maxAge: 60 * 60 * 1000 } // 1 hora
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

// --- Rutas estáticas frontend ---
app.use(express.static(path.join(__dirname, "../frontend")));

// --- Rutas privadas (login/admin) ---
app.use("/private", express.static(path.join(__dirname, "private")));

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "1234";

// --- Login ---
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

// Middleware de protección admin
function requireAdmin(req, res, next) {
  if (req.session.isAdmin) next();
  else res.status(403).json({ error: "Acceso denegado" });
}

// Verificar sesión
app.get("/check-session", (req, res) => {
  res.json({ loggedIn: !!req.session.isAdmin });
});

// Servir admin.html solo si está logueado
app.get("/admin.html", requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "private/admin.html"));
});

// --- CRUD Players ---
// Añadir jugador
app.post("/players", requireAdmin, async (req, res) => {
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
app.get("/players", requireAdmin, async (req, res) => {
  try {
    const players = await playersCollection.find().toArray();
    res.json(players);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener jugadores" });
  }
});

// Editar jugador
app.put("/players", requireAdmin, async (req, res) => {
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
app.delete("/players", requireAdmin, async (req, res) => {
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

// --- CRUD Matches ---
app.post("/matches", requireAdmin, async (req, res) => {
  try {
    const { match, winnerTeam } = req.body;
    if (!Array.isArray(match) || match.length !== 10) return res.status(400).json({ error: "Formato inválido" });

    await matchesCollection.insertOne({ match, winnerTeam, date: new Date() });

    for (const p of match) {
      const playerTeam = match.indexOf(p) < 5 ? "A" : "B";
      const headshotKills = Math.round((p.hsPercent / 100) * p.kills);

      await playersCollection.updateOne(
        { name: p.name, tag: p.tag },
        {
          $inc: {
            totalKills: p.kills,
            totalDeaths: p.deaths,
            totalAssists: p.assists,
            totalACS: p.acs,
            totalFirstBloods: p.firstBloods,
            totalHeadshotKills: headshotKills,
            matchesPlayed: 1,
            wins: playerTeam === winnerTeam ? 1 : 0,
          },
        }
      );
    }

    res.json({ message: "Partida añadida exitosamente" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al añadir partida" });
  }
});

// Leaderboard público
app.get("/leaderboard", async (req, res) => {
  try {
    const players = await playersCollection.find().toArray();
    const withScores = players.map(p => {
      const matches = p.matchesPlayed || 0;
      const avgKills = matches ? p.totalKills / matches : 0;
      const avgDeaths = matches ? p.totalDeaths / matches : 1;
      const avgACS = matches ? p.totalACS / matches : 0;
      const avgFirstBloods = matches ? p.totalFirstBloods / matches : 0;
      const avgAssists = matches ? p.totalAssists / matches : 0;
      const winrate = matches ? (p.wins / matches) * 100 : 0;
      const hsPercent = p.totalKills ? (p.totalHeadshotKills / p.totalKills) * 100 : 0;

      const avgKDA = avgDeaths === 0 ? avgKills : avgKills / avgDeaths;
      const cappedKills = Math.min(avgKills, 30);
      const impactKillsScore = (avgFirstBloods * 1.5) + (cappedKills - avgFirstBloods);

      const scoreRaw = (avgACS * 1.5) + (impactKillsScore * 1.2) + (avgAssists * 0.8) + (hsPercent) + (winrate) - (avgDeaths);
      const reliabilityFactor = Math.min(matches / 5, 1);
      const consistencyBonus = 1 + (Math.min(matches, 20) / 100);

      return { name: p.name, tag: p.tag, avgKills, avgDeaths, avgACS, avgFirstBloods, avgAssists, hsPercent, winrate, avgKDA, score: scoreRaw * consistencyBonus * reliabilityFactor, matchesPlayed: matches };
    });

    withScores.sort((a, b) => b.score - a.score);
    res.json(withScores);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al generar leaderboard" });
  }
});

// Historial de un jugador
app.get("/matches/:name/:tag", async (req, res) => {
  try {
    const { name, tag } = req.params;
    const matches = await matchesCollection.find({ match: { $elemMatch: { name, tag } } }).toArray();
    res.json(matches);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener historial" });
  }
});

// Contador de partidas
app.get("/matches-count", async (req, res) => {
  try {
    const count = await matchesCollection.countDocuments();
    res.json({ count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener total de partidas" });
  }
});

// --- Iniciar servidor ---
connectDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));
});
