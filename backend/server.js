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

let db, playersCollection, matchesCollection, eventsCollection;
async function connectDB() {
  try {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    db = client.db("valorantDB");
    playersCollection = db.collection("players");
    matchesCollection = db.collection("matches");
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

app.get("/admin.html", requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "private/admin.html"));
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

// -------------------
// --- CRUD Matches
// -------------------
app.post("/matches", requireAdmin, async (req, res) => {
  try {
    const { match, winnerTeam, score, map, eventId } = req.body;
    if (!Array.isArray(match) || match.length === 0) return res.status(400).json({ error: "Formato inválido" });
    if (!score || typeof score !== "string") return res.status(400).json({ error: "Score final requerido" });
    if (!map || typeof map !== "string") return res.status(400).json({ error: "Mapa requerido" });

    const newMatch = { match, winnerTeam, score, map, date: new Date() };
    await matchesCollection.insertOne(newMatch);

    // Si la partida pertenece a un evento
    if (eventId) {
      await eventsCollection.updateOne(
        { _id: new ObjectId(eventId) },
        { $push: { matches: newMatch } }
      );
    }

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
            wins: playerTeam === winnerTeam ? 1 : 0
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

app.get("/matches", async (req, res) => {
  try {
    const matches = await matchesCollection.find().sort({ date: -1 }).toArray();
    res.json(matches);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener partidas" });
  }
});

app.put("/matches/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { map, winnerTeam, score } = req.body;
    if (!map || !winnerTeam || !score) return res.status(400).json({ error: "Faltan datos" });

    const result = await matchesCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { map, winnerTeam, score } }
    );

    if (result.matchedCount === 0) return res.status(404).json({ error: "Partida no encontrada" });

    res.json({ message: "Partida actualizada correctamente" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al actualizar partida" });
  }
});

// -------------------
// --- CRUD Events / Torneos
// -------------------
app.post("/events", requireAdmin, async (req, res) => {
  try {
    const { name, teamSize, numTeams, rounds = 0 } = req.body;
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
      createdAt: new Date()
    };

    await eventsCollection.insertOne(newEvent);
    res.json({ message: "Evento creado correctamente" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al crear evento" });
  }
});

app.get("/events", requireAdmin, async (req, res) => {
  try {
    const events = await eventsCollection.find().sort({ createdAt: -1 }).toArray();
    res.json(events);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener eventos" });
  }
});

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
// --- Rutas públicas
// -------------------
app.get("/leaderboard", async (req, res) => {
  try {
    const players = await playersCollection.find().toArray();
    const withScores = players.map(p => {
      const matches = p.matchesPlayed || 0;
      const avgKills = matches ? p.totalKills / matches : 0;
      const avgDeaths = matches ? p.totalDeaths / matches : 1;
      const avgACS = matches ? p.totalACS / matches : 0;
      const avgAssists = matches ? p.totalAssists / matches : 0;
      const winrate = matches ? (p.wins / matches) * 100 : 0;
      const hsPercent = p.totalKills ? (p.totalHeadshotKills / p.totalKills) * 100 : 0;
      const avgKDA = avgDeaths === 0 ? avgKills : avgKills / avgDeaths;
      const cappedKills = Math.min(avgKills, 30);
      const impactKillsScore = (p.totalFirstBloods * 1.5) + (cappedKills - p.totalFirstBloods);
      const scoreRaw = (avgACS * 1.5) + (impactKillsScore * 1.2) + (avgAssists * 0.8) + hsPercent + winrate - avgDeaths;
      const reliabilityFactor = Math.min(matches / 5, 1);
      const consistencyBonus = 1 + (Math.min(matches, 20) / 100);

      return {
        name: p.name,
        tag: p.tag,
        avgACS,
        avgKDA,
        hsPercent,
        fk: matches ? (p.totalFirstBloods / matches) : 0,
        winrate,
        score: Math.round(scoreRaw * consistencyBonus * reliabilityFactor),
        matchesPlayed: matches,
        badges: p.badges || [],
        social: p.social || {}
      };
    });

    withScores.sort((a, b) => b.score - a.score);
    res.json(withScores);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al generar leaderboard" });
  }
});

app.get("/matches/:name/:tag", async (req, res) => {
  try {
    const { name, tag } = req.params;
    const matches = await matchesCollection.find({ match: { $elemMatch: { name, tag } } }).sort({ date: -1 }).toArray();
    res.json(matches.map(m => ({
      match: m.match,
      winnerTeam: m.winnerTeam,
      score: m.score,
      date: m.date
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener historial" });
  }
});

app.get("/matches-count", async (req, res) => {
  try {
    const count = await matchesCollection.countDocuments();
    res.json({ count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener total de partidas" });
  }
});

app.get("/players-count", async (req, res) => {
  try {
    const count = await playersCollection.countDocuments();
    res.json({ count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener total de jugadores" });
  }
});

app.get("/last-match", async (req, res) => {
  try {
    const lastMatch = await matchesCollection.find().sort({ date: -1 }).limit(1).toArray();
    if (lastMatch.length === 0) return res.json({ date: null });
    res.json({ date: lastMatch[0].date });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener última partida" });
  }
});

// Public route for getting events (visible on frontend)
app.get("/events-public", async (req, res) => {
  try {
    const events = await eventsCollection.find().sort({ createdAt: -1 }).toArray();
    res.json(events.map(e => ({
      _id: e._id,
      name: e.name,
      teamSize: e.teamSize,
      numTeams: e.numTeams,
      rounds: e.rounds,
      matches: e.matches || []
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener eventos" });
  }
});

// -------------------
// --- Iniciar servidor
// -------------------
connectDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));
});
