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

// ==========================
// CORS
// ==========================
const allowedOrigins = [
  "https://valorant-10-mans-frontend.onrender.com",
  "https://valorant-10-mans.onrender.com"
];

app.set('trust proxy', 1);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());

// ==========================
// Sesiones con MongoStore
// ==========================
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

// ==========================
// Conexión MongoDB
// ==========================
if (!process.env.MONGODB_URI) {
  console.error("❌ ERROR: MONGODB_URI no está definido.");
  process.exit(1);
}

let db, playersCollection, matchesCollection, usersCollection, customMatchesCollection, queueCollection;

async function connectDB() {
  try {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    db = client.db("valorantDB");
    playersCollection = db.collection("players");
    matchesCollection = db.collection("matches");
    usersCollection = db.collection("users");
    customMatchesCollection = db.collection("customMatches");
    queueCollection = db.collection("globalQueue");

    console.log("✅ MongoDB conectado");
  } catch (err) {
    console.error("❌ Error conectando a MongoDB:", err);
    process.exit(1);
  }
}

// ==========================
// Middlewares Auth
// ==========================
function requireAuth(req, res, next) {
  if (req.session?.userId) next();
  else res.status(401).json({ error: "No autorizado" });
}

function requireAdmin(req, res, next) {
  if (req.session.isAdmin) next();
  else res.status(403).json({ error: "Acceso denegado" });
}

// ==========================
// Variables globales
// ==========================
const TEST_PLAYER_COUNT = 10;
const MAPS = ["Ascent", "Bind", "Haven", "Icebox", "Breeze"];

// ==========================
// Función de score
// ==========================
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

  let mapped = (maxBase === minBase) ? (outMin + outMax) / 2 : ((base - minBase) * (outMax - outMin)) / (maxBase - minBase) + outMin;

  let totalScore = Math.round(mapped);
  if (!didWin) totalScore = Math.max(0, totalScore - 5);

  return { totalScore, basePoints: Math.round(mapped) };
}

// ==========================
// API Router
// ==========================
const apiRouter = express.Router();

// --------------------------
// Queue / Join (global queue)
// --------------------------
apiRouter.post("/queue/join", requireAuth, async (req, res) => {
  try {
    // Atómico: agregar jugador a la cola global
    const updatedQueue = await queueCollection.findOneAndUpdate(
      { _id: "globalQueue" },
      { $addToSet: { players: req.session.userId } },
      { returnDocument: "after", upsert: true }
    );

    const queuePlayers = updatedQueue.value.players;

    // Revisar si hay suficientes jugadores para iniciar partida
    if (queuePlayers.length >= TEST_PLAYER_COUNT) {
      const matchPlayers = queuePlayers.slice(0, TEST_PLAYER_COUNT);

      // Crear equipos aleatorios
      const shuffled = [...matchPlayers].sort(() => 0.5 - Math.random());
      const teamA = shuffled.slice(0, 5);
      const teamB = shuffled.slice(5, 10);
      const map = MAPS[Math.floor(Math.random() * MAPS.length)];
      const leaderId = matchPlayers[Math.floor(Math.random() * matchPlayers.length)];

      // Crear partida
      const newMatch = {
        players: matchPlayers,
        teamA,
        teamB,
        leaderId,
        map,
        status: "in_progress",
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await customMatchesCollection.insertOne(newMatch);

      // Remover jugadores de la cola global
      await queueCollection.updateOne(
        { _id: "globalQueue" },
        { $pull: { players: { $in: matchPlayers } } }
      );

      return res.json({ success: true, match: newMatch, message: "Partida creada automáticamente" });
    }

    res.json({ success: true, queueLength: queuePlayers.length, message: "Jugador agregado a la cola" });

  } catch (err) {
    console.error("Error en /queue/join:", err);
    res.status(500).json({ error: "Error del servidor" });
  }
});

// --------------------------
// Queue / Leave
// --------------------------
apiRouter.post("/queue/leave", requireAuth, async (req, res) => {
  try {
    await queueCollection.updateOne(
      { _id: "globalQueue" },
      { $pull: { players: req.session.userId } }
    );
    res.json({ success: true, message: "Jugador removido de la cola" });
  } catch (err) {
    console.error("Error en /queue/leave:", err);
    res.status(500).json({ error: "Error del servidor" });
  }
});

// --------------------------
// Queue / Active Matches
// --------------------------
apiRouter.get("/queue/active", requireAuth, async (req, res) => {
  try {
    const matches = await customMatchesCollection.find({ status: { $in: ["waiting", "in_progress"] } }).toArray();
    res.json({ success: true, matches });
  } catch (err) {
    console.error("Error en /queue/active:", err);
    res.status(500).json({ error: "Error del servidor" });
  }
});

// --------------------------
// Submit Match Result
// --------------------------
apiRouter.post("/match/submit", requireAuth, async (req, res) => {
  try {
    const { matchId, playerStats, winnerTeam } = req.body;
    if (!matchId || !playerStats || !winnerTeam) return res.status(400).json({ error: "Datos incompletos" });

    const match = await customMatchesCollection.findOne({ _id: new ObjectId(matchId) });
    if (!match) return res.status(404).json({ error: "Partida no encontrada" });

    // Calcular scores de cada jugador
    const teamStatsA = match.teamA.map(pid => playerStats.find(p => p.userId === pid));
    const teamStatsB = match.teamB.map(pid => playerStats.find(p => p.userId === pid));

    const results = playerStats.map(ps => {
      const team = match.teamA.includes(ps.userId) ? "A" : "B";
      const didWin = (team === winnerTeam);
      return {
        userId: ps.userId,
        totalScore: calculateMatchScore(ps, team, team === "A" ? teamStatsA : teamStatsB, didWin).totalScore
      };
    });

    // Actualizar partida
    await customMatchesCollection.updateOne(
      { _id: new ObjectId(matchId) },
      { $set: { status: "completed", winnerTeam, results, updatedAt: new Date() } }
    );

    res.json({ success: true, message: "Resultado registrado", results });
  } catch (err) {
    console.error("Error en /match/submit:", err);
    res.status(500).json({ error: "Error del servidor" });
  }
});

// --------------------------
// Leaderboard
// --------------------------
apiRouter.get("/leaderboard", async (req, res) => {
  try {
    const completedMatches = await customMatchesCollection.find({ status: "completed" }).toArray();

    const leaderboardMap = {};

    completedMatches.forEach(match => {
      match.results.forEach(r => {
        if (!leaderboardMap[r.userId]) leaderboardMap[r.userId] = 0;
        leaderboardMap[r.userId] += r.totalScore;
      });
    });

    const leaderboard = Object.entries(leaderboardMap)
      .map(([userId, score]) => ({ userId, score }))
      .sort((a, b) => b.score - a.score);

    res.json({ success: true, leaderboard });
  } catch (err) {
    console.error("Error en /leaderboard:", err);
    res.status(500).json({ error: "Error del servidor" });
  }
});

// --------------------------
// Discord OAuth Login
// --------------------------
apiRouter.get("/auth/discord", (req, res) => {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const redirectUri = encodeURIComponent(process.env.DISCORD_REDIRECT_URI);
  const scope = encodeURIComponent("identify");
  res.redirect(`https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}`);
});

apiRouter.get("/auth/discord/callback", async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) return res.status(400).json({ error: "No se recibió código" });

    // Intercambiar code por token
    const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: process.env.DISCORD_REDIRECT_URI
      })
    });
    const tokenData = await tokenResponse.json();
    if (!tokenData.access_token) return res.status(400).json({ error: "Token no recibido" });

    // Obtener info de usuario
    const userResponse = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const discordUser = await userResponse.json();

    // Guardar/Actualizar usuario en DB
    const user = await usersCollection.findOneAndUpdate(
      { discordId: discordUser.id },
      { $set: { username: discordUser.username, discriminator: discordUser.discriminator } },
      { upsert: true, returnDocument: "after" }
    );

    req.session.userId = user.value._id.toString();
    req.session.isAdmin = false; // O lógica para admin
    res.redirect("/"); // Redirige al frontend
  } catch (err) {
    console.error("Error en /auth/discord/callback:", err);
    res.status(500).json({ error: "Error autenticando Discord" });
  }
});

// --------------------------
// Admin Login / Logout
// --------------------------
app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
    req.session.isAdmin = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ error: "Usuario o contraseña incorrectos" });
  }
});

app.post("/logout", (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: "Error cerrando sesión" });
    res.clearCookie('connect.sid');
    res.json({ success: true, message: "Sesión cerrada" });
  });
});

app.get("/check-session", (req, res) => {
  res.json({ loggedIn: !!req.session.isAdmin });
});

// --------------------------
// CRUD Jugadores
// --------------------------
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
    res.json({ success: true, message: "Jugador añadido exitosamente" });
  } catch (err) {
    console.error("Error en POST /players:", err);
    res.status(500).json({ error: "Error al añadir jugador" });
  }
});

app.get("/players", requireAdmin, async (req, res) => {
  try {
    const players = await playersCollection.find().toArray();
    res.json({ success: true, players });
  } catch (err) {
    console.error("Error en GET /players:", err);
    res.status(500).json({ error: "Error al obtener jugadores" });
  }
});

app.put("/players/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const result = await playersCollection.updateOne({ _id: new ObjectId(id) }, { $set: updates });
    if (result.matchedCount === 0) return res.status(404).json({ error: "Jugador no encontrado" });
    res.json({ success: true, message: "Jugador actualizado" });
  } catch (err) {
    console.error("Error en PUT /players/:id:", err);
    res.status(500).json({ error: "Error actualizando jugador" });
  }
});

app.delete("/players/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await playersCollection.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) return res.status(404).json({ error: "Jugador no encontrado" });
    res.json({ success: true, message: "Jugador eliminado" });
  } catch (err) {
    console.error("Error en DELETE /players/:id:", err);
    res.status(500).json({ error: "Error eliminando jugador" });
  }
});

// --------------------------
// CRUD Partidas (Admin)
// --------------------------
app.post("/matches", requireAdmin, async (req, res) => {
  try {
    const { match, winnerTeam, score, map } = req.body;
    if (!match || !Array.isArray(match)) return res.status(400).json({ error: "Formato inválido" });

    const newMatch = { match, winnerTeam, score, map, date: new Date() };
    await matchesCollection.insertOne(newMatch);
    res.json({ success: true, message: "Partida añadida exitosamente" });
  } catch (err) {
    console.error("Error en POST /matches:", err);
    res.status(500).json({ error: "Error al añadir partida" });
  }
});

app.get("/matches", requireAdmin, async (req, res) => {
  try {
    const matches = await matchesCollection.find().sort({ date: -1 }).toArray();
    res.json({ success: true, matches });
  } catch (err) {
    console.error("Error en GET /matches:", err);
    res.status(500).json({ error: "Error obteniendo partidas" });
  }
});

app.put("/matches/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const result = await matchesCollection.updateOne({ _id: new ObjectId(id) }, { $set: updates });
    if (result.matchedCount === 0) return res.status(404).json({ error: "Partida no encontrada" });
    res.json({ success: true, message: "Partida actualizada" });
  } catch (err) {
    console.error("Error en PUT /matches/:id:", err);
    res.status(500).json({ error: "Error actualizando partida" });
  }
});

app.delete("/matches/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await matchesCollection.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) return res.status(404).json({ error: "Partida no encontrada" });
    res.json({ success: true, message: "Partida eliminada" });
  } catch (err) {
    console.error("Error en DELETE /matches/:id:", err);
    res.status(500).json({ error: "Error eliminando partida" });
  }
});

// --------------------------
// Estadísticas y contadores
// --------------------------
app.get("/players-count", async (req, res) => {
  try {
    const count = await playersCollection.countDocuments();
    res.json({ success: true, count });
  } catch (err) {
    console.error("Error en GET /players-count:", err);
    res.status(500).json({ error: "Error al obtener total de jugadores" });
  }
});

app.get("/matches-count", async (req, res) => {
  try {
    const count = await matchesCollection.countDocuments();
    res.json({ success: true, count });
  } catch (err) {
    console.error("Error en GET /matches-count:", err);
    res.status(500).json({ error: "Error al obtener total de partidas" });
  }
});

app.get("/last-match", async (req, res) => {
  try {
    const lastMatch = await matchesCollection.find().sort({ date: -1 }).limit(1).toArray();
    res.json({ success: true, lastMatch: lastMatch[0] || null });
  } catch (err) {
    console.error("Error en GET /last-match:", err);
    res.status(500).json({ error: "Error al obtener última partida" });
  }
});

// --------------------------
// Manejo global de errores y 404
// --------------------------
app.use((err, req, res, next) => {
  console.error("Error no manejado:", err);
  res.status(500).json({ error: "Error interno del servidor" });
});

app.use((req, res) => {
  res.status(404).json({ error: "Endpoint no encontrado" });
});

// --------------------------
// Montar API Router
// --------------------------
app.use("/api", apiRouter);

// --------------------------
// Iniciar servidor y conexión a MongoDB
// --------------------------
connectDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));
}).catch(err => {
  console.error("❌ Error iniciando servidor:", err);
  process.exit(1);
});

