import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv";
import { newQueueRouter, initQueueDB } from "./queueManager.js";
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
  cookie: {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    maxAge: 60 * 60 * 1000
  }
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
// --- Función de cálculo de score por partida ajustada por rol
// -------------------
function calculateMatchScore(playerStats, playerTeam, teamStats, didWin) {
  const duelistas = ["Jett", "Reyna", "Phoenix", "Raze", "Yoru", "Neon", "Iso", "Waylay"];
  const iniciadores = ["Sova", "Skye", "KAY/O", "Fade", "Breach", "Gekko", "Tejo"];
  const controladores = ["Omen", "Viper", "Brimstone", "Astra", "Clove", "Harbor"];
  const centinelas = ["Sage", "Killjoy", "Cypher", "Chamber", "Deadlock", "Vyse"];

  let roleWeight = {
    kills: 1.0, deaths: -0.8, assists: 0.7, ACS: 0.05,
    ADR: 0.05, DDDelta: 0.08, hsPercent: 0.1, KAST: 0.08,
    FK: 2.0, FD: -1.0, MK: 1.2
  };

  const char = playerStats.character;
  if (duelistas.includes(char)) { roleWeight.kills = 1.5; roleWeight.FK = 2.5; roleWeight.MK = 1.5; }
  else if (iniciadores.includes(char)) { roleWeight.KAST = 0.12; roleWeight.ADR = 0.07; }
  else if (controladores.includes(char)) { roleWeight.KAST = 0.12; roleWeight.assists = 0.9; }
  else if (centinelas.includes(char)) { roleWeight.KAST = 0.1; roleWeight.assists = 0.85; }

  const base =
    playerStats.kills * roleWeight.kills +
    playerStats.deaths * roleWeight.deaths +
    playerStats.assists * roleWeight.assists +
    playerStats.ACS * roleWeight.ACS +
    playerStats.ADR * roleWeight.ADR +
    playerStats.DDDelta * roleWeight.DDDelta +
    playerStats.hsPercent * roleWeight.hsPercent +
    playerStats.KAST * roleWeight.KAST +
    playerStats.FK * roleWeight.FK +
    playerStats.FD * roleWeight.FD +
    playerStats.MK * roleWeight.MK;

  const teamBases = teamStats.map(p =>
    p.kills * roleWeight.kills +
    p.deaths * roleWeight.deaths +
    p.assists * roleWeight.assists +
    p.ACS * roleWeight.ACS +
    p.ADR * roleWeight.ADR +
    p.DDDelta * roleWeight.DDDelta +
    p.hsPercent * roleWeight.hsPercent +
    p.KAST * roleWeight.KAST +
    p.FK * roleWeight.FK +
    p.FD * roleWeight.FD +
    p.MK * roleWeight.MK
  );

  const minBase = Math.min(...teamBases);
  const maxBase = Math.max(...teamBases);
  const outMin = 5;
  const outMax = 20;

  let mapped;
  if (maxBase === minBase) {
    mapped = (outMin + outMax) / 2;
  } else {
    mapped = ((base - minBase) * (outMax - outMin)) / (maxBase - minBase) + outMin;
  }

  let totalScore = Math.round(mapped);

  // Si el equipo perdió, restamos 5 puntos
  if (!didWin) totalScore = Math.max(0, totalScore - 5);

  return {
    totalScore,
    basePoints: Math.round(mapped)
  };
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
      totalKills: 0,
      totalDeaths: 0,
      totalAssists: 0,
      totalACS: 0,
      totalDDDelta: 0,
      totalADR: 0,
      totalHeadshotKills: 0,
      totalKAST: 0,
      totalFK: 0,
      totalFD: 0,
      totalMK: 0,
      matchesPlayed: 0,
      wins: 0,
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

    const playersWithPercentages = players.map(p => {
      const matches = p.matchesPlayed || 1; // evitar división entre 0
      return {
        ...p,
        hsPercent: p.totalKills ? Math.round((p.totalHeadshotKills / p.totalKills) * 100) : 0,
        KASTPercent: matches ? Math.round(p.totalKAST / matches) : 0
      };
    });

    res.json(playersWithPercentages);
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

      // Calcular score con la función existente
      const { totalScore } = calculateMatchScore(p, playerTeam, teamStats);

      // Buscar stats actuales del jugador
      const currentPlayer = await playersCollection.findOne({ name: p.name, tag: p.tag });
      const newTotalScore = Math.max((currentPlayer.score || 0) + totalScore, 0);

      // Headshots reales
      const headshotsThisMatch = Math.round((p.hsPercent / 100) * p.kills);

      // Actualizar stats acumuladas del jugador
      await playersCollection.updateOne(
        { name: p.name, tag: p.tag },
        {
          $inc: {
            totalKills: p.kills,
            totalDeaths: p.deaths,
            totalAssists: p.assists,
            totalACS: p.ACS,
            totalDDDelta: p.DDDelta,
            totalADR: p.ADR,
            totalHeadshotKills: headshotsThisMatch,
            totalKAST: p.KAST,
            totalFK: p.FK,
            totalFD: p.FD,
            totalMK: p.MK,
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
    // 1️⃣ Buscar y eliminar la partida
    const matchToDelete = await matchesCollection.findOne({ _id: new ObjectId(id) });
    if (!matchToDelete) return res.status(404).json({ error: "Partida no encontrada" });

    await matchesCollection.deleteOne({ _id: new ObjectId(id) });

    // 2️⃣ Resetear stats de todos los jugadores
    await playersCollection.updateMany({}, {
      $set: {
        totalKills: 0,
        totalDeaths: 0,
        totalAssists: 0,
        totalACS: 0,
        totalDDDelta: 0,
        totalADR: 0,
        totalHeadshotKills: 0,
        totalKAST: 0,
        totalFK: 0,
        totalFD: 0,
        totalMK: 0,
        matchesPlayed: 0,
        wins: 0,
        score: 0
      }
    });

    // 3️⃣ Obtener todas las partidas restantes
    const allMatches = await matchesCollection.find().toArray();

    // 4️⃣ Recalcular stats acumuladas de cada jugador
    for (const match of allMatches) {
      const teamA = match.match.slice(0, 5);
      const teamB = match.match.slice(5, 10);

      for (let i = 0; i < match.match.length; i++) {
        const p = match.match[i];
        const playerTeam = i < 5 ? "A" : "B";
        const teamStats = playerTeam === "A" ? teamA : teamB;
        const didWin = playerTeam === match.winnerTeam;

        // 5️⃣ Calcular score usando la misma función que en POST
        const { totalScore } = calculateMatchScore(p, playerTeam, teamStats, didWin);

        // Calcular headshots reales
        const headshotsThisMatch = Math.round((p.hsPercent / 100) * p.kills);

        // Actualizar stats acumulativos
        await playersCollection.updateOne(
          { name: p.name, tag: p.tag },
          {
            $inc: {
              totalKills: p.kills,
              totalDeaths: p.deaths,
              totalAssists: p.assists,
              totalACS: p.ACS,
              totalDDDelta: p.DDDelta,
              totalADR: p.ADR,
              totalHeadshotKills: headshotsThisMatch,
              totalKAST: p.KAST,
              totalFK: p.FK,
              totalFD: p.FD,
              totalMK: p.MK,
              matchesPlayed: 1,
              wins: didWin ? 1 : 0,
              score: totalScore
            }
          }
        );
      }
    }

    res.json({ message: "✅ Partida eliminada y estadísticas recalculadas correctamente" });
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

    const formattedPlayers = players.map(p => {
      const matches = p.matchesPlayed || 1; // evitar división por 0

      return {
        ...p,
        // Promedios por partida
        avgACS: matches ? (p.totalACS / matches) : 0,
        avgFK: matches ? (p.totalFK / matches) : 0,
        avgADR: matches ? (p.totalADR / matches) : 0,
        avgDDDelta: matches ? (p.totalDDDelta / matches) : 0,
        avgKAST: matches ? (p.totalKAST / matches) : 0,
        hsPercent: p.totalKills ? (p.totalHeadshotKills / p.totalKills * 100) : 0
      };
    });

    // Ordenar por score descendente
    formattedPlayers.sort((a, b) => (b.score || 0) - (a.score || 0));

    res.json(formattedPlayers);
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
connectDB().then(async () => {
  await initQueueDB(db);
  app.use("/api", newQueueRouter);
  app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));
});
