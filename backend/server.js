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
// --- Función de cálculo de score por partida
// -------------------
function calculateMatchScore(playerStats, matchWinnerTeam, playerTeam, teamStats) {
  const won = playerTeam === matchWinnerTeam;

  //Calculamos baseScore
  const base =
    playerStats.kills * 1.0 +
    playerStats.assists * 0.7 +
    playerStats.firstBloods * 2 +
    playerStats.acs * 0.01 +
    playerStats.hsPercent * 0.1 -
    playerStats.deaths * 0.8;

  //Obtenemos los baseScore del equipo para normalizar
  const bases = teamStats.map(p =>
    p.kills * 1.0 +
    p.assists * 0.7 +
    p.firstBloods * 2 +
    p.acs * 0.01 +
    p.hsPercent * 0.1 -
    p.deaths * 0.8
  );

  const minBase = Math.min(...bases);
  const maxBase = Math.max(...bases);

  //Definir rango de salida
  const outMin = won ? 10 : -10;
  const outMax = won ? 20 : 0;

  //Mapear baseScore al rango
  let mapped;
  if (maxBase === minBase) {
    mapped = (outMin + outMax) / 2;
  } else {
    mapped =
      ((base - minBase) * (outMax - outMin)) / (maxBase - minBase) + outMin;
  }

  //Redondear entero
  const totalScore = Math.round(mapped);

  return {
    totalScore,
    basePoints: Math.round(mapped), // mismo valor en este caso
    bonus: 0 // puedes añadir reglas de bonus si quieres después
  };
}

// -------------------
// --- Función para recalcular todas las stats
// -------------------
async function recalculateAllScores() {
  try {
    // 1️⃣ Reiniciar stats de todos los jugadores
    await playersCollection.updateMany({}, {
      $set: {
        totalKills: 0,
        totalDeaths: 0,
        totalAssists: 0,
        totalACS: 0,
        totalFirstBloods: 0,
        totalHeadshotKills: 0,
        matchesPlayed: 0,
        wins: 0,
        score: 0
      }
    });

    // 2️⃣ Traer todas las partidas ordenadas por fecha
    const allMatches = await matchesCollection.find().sort({ date: 1 }).toArray();

    // 3️⃣ Iterar sobre todas las partidas
    for (const matchData of allMatches) {
      const match = matchData.match;
      const winnerTeam = matchData.winnerTeam;

      const teamA = match.slice(0, 5);
      const teamB = match.slice(5, 10);

      for (let i = 0; i < match.length; i++) {
        const p = match[i];
        const playerTeam = i < 5 ? "A" : "B";
        const teamStats = playerTeam === "A" ? teamA : teamB;

        // Recalcular score
        const { totalScore } = calculateMatchScore(p, winnerTeam, playerTeam, teamStats);

        const headshotsThisMatch = Math.round((p.hsPercent / 100) * p.kills);

        // Actualizar stats acumuladas del jugador
        await playersCollection.updateOne(
          { name: p.name, tag: p.tag },
          {
            $inc: {
              totalKills: p.kills,
              totalDeaths: p.deaths,
              totalAssists: p.assists,
              totalACS: p.acs,
              totalFirstBloods: p.firstBloods,
              totalHeadshotKills: headshotsThisMatch,
              matchesPlayed: 1,
              wins: playerTeam === winnerTeam ? 1 : 0,
              score: totalScore
            }
          }
        );
      }
    }

    console.log("✅ Todos los scores recalculados correctamente.");
  } catch (err) {
    console.error("❌ Error recalculando scores:", err);
  }
}

// -------------------
// --- Login / Admin
// -------------------
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "1234";

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.isAdmin = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ error: "Usuario o contraseña incorrectos" });
  }
});

function requireAdmin(req, res, next) {
  if (req.session.isAdmin) next();
  else res.status(403).json({ error: "Acceso denegado" });
}

// -------------------
// --- Rutas admin.html / login
// -------------------
app.get("/login.html", (req, res) => {
  res.sendFile(path.join(__dirname, "private/login.html"));
});

app.get("/check-session", (req, res) => {
  res.json({ loggedIn: !!req.session.isAdmin });
});

app.get("/admin.html", requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "private/admin.html"));
});

app.post("/logout", (req, res) => {
  req.session.destroy(err => {
    if(err) return res.status(500).json({ error: "Error cerrando sesión" });
    res.clearCookie('connect.sid');
    res.json({ message: "Sesión cerrada" });
  });
});

// -------------------
// --- CRUD Players
// -------------------
app.post("/players", requireAdmin, async (req, res) => {
  try {
    const { name, tag, badges = [], social = {}, avatarURL } = req.body;
    if (!name || !tag) return res.status(400).json({ error: "Nombre y tag requeridos" });

    const exists = await playersCollection.findOne({ name, tag });
    if (exists) return res.status(400).json({ error: "Jugador ya existe" });

    const newPlayer = {
      name: name.trim(),
      tag: tag.trim(),
      totalKills: 0, totalDeaths: 0, totalAssists: 0,
      totalACS: 0, totalFirstBloods: 0, totalHeadshotKills: 0,
      matchesPlayed: 0, wins: 0,
      badges,
      social,
      avatarURL: avatarURL || null,
      score: 0
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
  const { oldName, oldTag, newName, newTag, social, avatarURL } = req.body;
  try {
    await playersCollection.updateOne(
      { name: oldName, tag: oldTag },
      { $set: { name: newName, tag: newTag, social, avatarURL } }
    );
    res.json({ message: "Jugador actualizado" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error actualizando jugador" });
  }
});

app.delete("/players", requireAdmin, async (req, res) => {
  const { name, tag } = req.body;
  try {
    await playersCollection.deleteOne({ name, tag });
    res.json({ message: "Jugador eliminado" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error eliminando jugador" });
  }
});

// -------------------
// --- CRUD Matches
// -------------------
app.post("/matches", requireAdmin, async (req, res) => {
  try {
    const { match, winnerTeam, score: matchScore, map } = req.body;

    if (!Array.isArray(match) || match.length === 0) 
      return res.status(400).json({ error: "Formato inválido" });

    // Guardar la partida en la base
    const newMatch = { match, winnerTeam, score: matchScore, map, date: new Date() };
    await matchesCollection.insertOne(newMatch);

    // Separar equipos
    const teamA = match.slice(0, 5);
    const teamB = match.slice(5, 10);

    for (let i = 0; i < match.length; i++) {
      const p = match[i];
      const playerTeam = i < 5 ? "A" : "B";
      const teamStats = playerTeam === "A" ? teamA : teamB;

      // Calcular score con la nueva función
      const { totalScore } = calculateMatchScore(p, winnerTeam, playerTeam, teamStats);

      // Buscar stats actuales del jugador
      const currentPlayer = await playersCollection.findOne({ name: p.name, tag: p.tag });
      const newTotalScore = Math.max((currentPlayer.score || 0) + totalScore, 0);

      const headshotsThisMatch = Math.round((p.hsPercent / 100) * p.kills);

      // Actualizar stats acumuladas del jugador
      await playersCollection.updateOne(
        { name: p.name, tag: p.tag },
        {
          $inc: {
            totalKills: p.kills,
            totalDeaths: p.deaths,
            totalAssists: p.assists,
            totalACS: p.acs,
            totalFirstBloods: p.firstBloods,
            totalHeadshotKills: headshotsThisMatch,
            matchesPlayed: 1,
            wins: playerTeam === winnerTeam ? 1 : 0
          },
          $set: { score: newTotalScore }
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
    res.status(500).json({ error: "Error obteniendo partidas" });
  }
});

app.put("/matches/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { map, score, winnerTeam } = req.body;
  try {
    await matchesCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { map, score, winnerTeam } }
    );
    res.json({ message: "Partida actualizada" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error actualizando partida" });
  }
});

app.delete("/matches/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    // Buscar la partida
    const match = await matchesCollection.findOne({ _id: new ObjectId(id) });
    if (!match) return res.status(404).json({ error: "Partida no encontrada" });

    // Eliminar la partida
    await matchesCollection.deleteOne({ _id: new ObjectId(id) });

    // Recalcular todos los scores usando tu función
    await recalculateAllScores();

    res.json({ message: "✅ Partida eliminada y todos los scores recalculados correctamente" });
  } catch (err) {
    console.error("❌ Error eliminando partida:", err);
    res.status(500).json({ error: "Error eliminando partida" });
  }
});

// -------------------
// --- Leaderboard
// -------------------
app.get("/leaderboard", async (req, res) => {
  try {
    const players = await playersCollection.find().toArray();
    players.sort((a, b) => (b.score || 0) - (a.score || 0));
    res.json(players);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error generando leaderboard" });
  }
});

// -------------------
// --- Endpoints adicionales
// -------------------
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
    res.json({ date: lastMatch[0]?.date || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener última partida" });
  }
});
// -------------------
// --- Servidor 
// -------------------
connectDB().then(() => {
  // Iniciamos el servidor
  app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));
});
