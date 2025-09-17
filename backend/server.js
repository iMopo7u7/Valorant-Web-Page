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
// CORS - Configuración
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
  ttl: 7 * 24 * 60 * 60,
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
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

// ==========================
// Conexión MongoDB
// ==========================
if (!process.env.MONGODB_URI) {
  console.error("❌ ERROR: MONGODB_URI no está definido.");
  process.exit(1);
}

let db, matchesCollection, usersCollection, queuesCollection;

async function connectDB() {
  try {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    // Apuntando a la nueva base de datos "AceHubDB"
    db = client.db("AceHubDB");
    matchesCollection = db.collection("matches");
    usersCollection = db.collection("users");
    queuesCollection = db.collection("queues");
    console.log("✅ MongoDB conectado a AceHubDB");
  } catch (err) {
    console.error("❌ Error conectando a MongoDB:", err);
    process.exit(1);
  }
}

// ==========================
// Middlewares de Autenticación
// ==========================
function requireAuth(req, res, next) {
  if (req.session?.userId) next();
  else res.status(401).json({ error: "No autorizado" });
}

async function fetchDiscordToken(params, retries = 3) {
  try {
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params
    });

    if (tokenRes.status === 429) {
      const retryAfter = parseFloat(tokenRes.headers.get("retry-after") || "1");
      console.warn(`Rate limit hit, retrying after ${retryAfter}s`);
      await new Promise(r => setTimeout(r, retryAfter * 1000));
      if (retries > 0) return fetchDiscordToken(params, retries - 1);
      throw new Error("Too many requests to Discord API");
    }

    if (!tokenRes.ok) throw new Error(`Discord token error: ${tokenRes.status}`);
    return await tokenRes.json();
  } catch (err) { throw err; }
}

async function refreshDiscordToken(discordSession) {
  const params = new URLSearchParams();
  params.append("client_id", process.env.DISCORD_CLIENT_ID);
  params.append("client_secret", process.env.DISCORD_CLIENT_SECRET);
  params.append("grant_type", "refresh_token");
  params.append("refresh_token", discordSession.refreshToken);
  params.append("redirect_uri", process.env.DISCORD_REDIRECT_URI);
  return await fetchDiscordToken(params);
}

async function requireAuthDiscord(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "No autorizado" });

  const user = await usersCollection.findOne({ discordId: req.session.userId });
  if (!user) return res.status(401).json({ error: "Usuario no encontrado" });

  if (user.discordSession && Date.now() > user.discordSession.expiresAt) {
    try {
      const tokenData = await refreshDiscordToken(user.discordSession);
      await usersCollection.updateOne(
        { discordId: user.discordId },
        { $set: { "discordSession.accessToken": tokenData.access_token, "discordSession.refreshToken": tokenData.refresh_token, "discordSession.expiresAt": Date.now() + (tokenData.expires_in * 1000) } }
      );
      user.discordSession.accessToken = tokenData.access_token;
    } catch (err) {
      console.error("Error refrescando token:", err);
      return res.status(401).json({ error: "Token expirado, vuelve a loguearte" });
    }
  }
  req.user = user;
  next();
}

async function requireAdmin(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: "No autorizado" });
  const user = await usersCollection.findOne({ discordId: req.session.userId });
  if (user && user.isAdmin) next();
  else res.status(403).json({ error: "Acceso denegado" });
}

// ==========================
// Lógica de cálculo de score
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
// Rutas de la API
// ==========================
const apiRouter = express.Router();

// Rutas de Autenticación
apiRouter.get("/auth/discord", (req, res) => {
  const redirectUri = process.env.DISCORD_REDIRECT_URI;
  const clientId = process.env.DISCORD_CLIENT_ID;
  const scope = "identify";
  const discordUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}`;
  res.redirect(discordUrl);
});

apiRouter.get("/auth/discord/callback", async (req, res) => {
  const code = req.query.code;
  try {
    if (!code) return res.status(400).json({ error: "No se recibió código de Discord" });

    const params = new URLSearchParams();
    params.append("client_id", process.env.DISCORD_CLIENT_ID);
    params.append("client_secret", process.env.DISCORD_CLIENT_SECRET);
    params.append("grant_type", "authorization_code");
    params.append("code", code);
    params.append("redirect_uri", process.env.DISCORD_REDIRECT_URI);

    const tokenData = await fetchDiscordToken(params);
    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });

    if (!userRes.ok) throw new Error(`Discord user fetch failed: ${userRes.status}`);
    const discordUser = await userRes.json();

    const existingUser = await usersCollection.findOne({ discordId: discordUser.id });

    let userUpdate;
    if (existingUser) {
      userUpdate = {
        $set: {
          username: discordUser.username,
          avatarURL: discordUser.avatar ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png` : null,
          discordSession: {
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            expiresAt: Date.now() + (tokenData.expires_in * 1000),
          },
          updatedAt: new Date(),
        }
      };
    } else {
      userUpdate = {
        $set: {
          discordId: discordUser.id,
          username: discordUser.username,
          avatarURL: discordUser.avatar ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png` : null,
          isAdmin: false,
          isAuthorized: false,
          discordSession: {
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            expiresAt: Date.now() + (tokenData.expires_in * 1000),
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      };
    }

    await usersCollection.updateOne({ discordId: discordUser.id }, userUpdate, { upsert: true });
    req.session.userId = discordUser.id;
    req.session.save(err => {
      if (err) return res.status(500).send("Error en login");
      res.redirect("https://valorant-10-mans-frontend.onrender.com");
    });
  } catch (err) {
    console.error("Error en Discord callback:", err);
    res.status(500).json({ error: "Error en login Discord" });
  }
});

// ---
// Rutas de Usuario
// ---
apiRouter.post("/user/setup", requireAuth, async (req, res) => {
  try {
    const { riotId, roles } = req.body;
    const userId = req.session.userId;

    if (!riotId || !roles || roles.length === 0) {
      return res.status(400).json({ error: "Riot ID y roles son requeridos" });
    }

    // Actualiza el usuario
    await usersCollection.updateOne(
      { discordId: userId },
      {
        $set: {
          riotId,
          name: riotId.split('#')[0],
          tag: riotId.split('#')[1],
          roles,
          updatedAt: new Date(),
        }
      }
    );

    const user = await usersCollection.findOne({ discordId: userId }, { projection: { "discordSession": 0 } });
    res.json(user);
  } catch (err) {
    console.error("Error en /user/setup:", err);
    res.status(500).json({ error: "Error del servidor" });
  }
});

apiRouter.get("/user/me", requireAuth, async (req, res) => {
  try {
    const user = await usersCollection.findOne({ discordId: req.session.userId }, { projection: { "discordSession": 0 } });
    if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json(user);
  } catch (err) {
    console.error("Error en /user/me:", err);
    res.status(500).json({ error: "Error del servidor" });
  }
});

apiRouter.put("/user/update", requireAuth, async (req, res) => {
  try {
    const { riotId, roles } = req.body;
    const userId = req.session.userId;

    const updateFields = { updatedAt: new Date() };
    if (riotId) {
      updateFields.riotId = riotId;
      updateFields.name = riotId.split('#')[0];
      updateFields.tag = riotId.split('#')[1];
    }
    if (roles) {
      updateFields.roles = roles;
    }

    if (Object.keys(updateFields).length === 1) { // Solo se actualizó la fecha
      return res.status(400).json({ error: "No se proporcionaron datos para actualizar" });
    }

    const user = await usersCollection.findOne({ discordId: userId });
    if (!user) return res.status(404).json({ error: "Usuario no encontrado" });

    await usersCollection.updateOne({ discordId: userId }, { $set: updateFields });
    res.json({ success: true, message: "Perfil actualizado correctamente." });
  } catch (err) {
    console.error("Error en /user/update:", err);
    res.status(500).json({ error: "Error del servidor" });
  }
});

// ---
// Rutas Públicas (public)
// ---
const publicRouter = express.Router();
const ITEMS_PER_PAGE = 20;

publicRouter.get("/stats", async (req, res) => {
  try {
    const users = await usersCollection.find({}, { projection: { discordSession: 0, "stats.elite": 0 } }).toArray();
    const publicActivePlayers = users.filter(u => u.stats?.public?.matchesPlayed > 0).length;
    const publicMatchesToday = await matchesCollection.countDocuments({
      matchType: "public",
      createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) }
    });

    const publicTotalPlayers = users.length;
    const stats = {
      publicActivePlayers,
      publicMatchesToday,
      publicTotalPlayers
    };
    res.json(stats);
  } catch (err) {
    console.error("Error en /public/stats:", err);
    res.status(500).json({ error: "Error del servidor" });
  }
});

publicRouter.get("/queue", async (req, res) => {
  try {
    const queueDoc = await queuesCollection.findOne({ _id: "globalQueues" });
    const publicPlayers = queueDoc?.public || [];
    const playersInQueue = await usersCollection.find({ discordId: { $in: publicPlayers } }).toArray();
    res.json(playersInQueue.map(p => ({
      id: p.discordId,
      username: p.username,
      avatarURL: p.avatarURL,
      roles: p.roles || []
    })));
  } catch (err) {
    console.error("Error en /public/queue:", err);
    res.status(500).json({ error: "Error del servidor" });
  }
});

publicRouter.get("/matches", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || ITEMS_PER_PAGE;
    const skip = (page - 1) * limit;

    const totalMatches = await matchesCollection.countDocuments({ matchType: "public", statsStatus: "completed" });
    const matches = await matchesCollection.find({ matchType: "public", statsStatus: "completed" })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    res.json({
      matches,
      totalMatches,
      page,
      pages: Math.ceil(totalMatches / limit)
    });
  } catch (err) {
    console.error("Error en /public/matches:", err);
    res.status(500).json({ error: "Error del servidor" });
  }
});

publicRouter.get("/leaderboard", async (req, res) => {
  try {
    const users = await usersCollection.find({}, { projection: { "discordSession": 0, "stats.elite": 0 } }).toArray();
    const leaderboard = users.map(u => ({
      id: u.discordId,
      username: u.username,
      riotId: u.riotId || "",
      roles: u.roles || [],
      avatarURL: u.avatarURL,
      stats: u.stats?.public || {},
      score: u.stats?.public?.score || 0
    })).sort((a, b) => b.score - a.score);
    res.json(leaderboard);
  } catch (err) {
    console.error("Error en /public/leaderboard:", err);
    res.status(500).json({ error: "Error del servidor" });
  }
});

publicRouter.get("/mymatches", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || ITEMS_PER_PAGE;
    const skip = (page - 1) * limit;

    const query = { "players.id": userId, matchType: "public", statsStatus: "completed" };

    const totalMatches = await matchesCollection.countDocuments(query);
    const matches = await matchesCollection.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    res.json({
      matches,
      totalMatches,
      page,
      pages: Math.ceil(totalMatches / limit)
    });
  } catch (err) {
    console.error("Error en /public/mymatches:", err);
    res.status(500).json({ error: "Error del servidor" });
  }
});

// ---
// Rutas Elite (elite)
// ---
const eliteRouter = express.Router();

eliteRouter.get("/stats", async (req, res) => {
  try {
    const users = await usersCollection.find({ isAuthorized: true }, { projection: { discordSession: 0, "stats.public": 0 } }).toArray();
    const eliteActivePlayers = users.filter(u => u.stats?.elite?.matchesPlayed > 0).length;
    const eliteMatchesToday = await matchesCollection.countDocuments({
      matchType: "elite",
      createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) }
    });
    const eliteTotalPlayers = users.length;
    const stats = {
      eliteActivePlayers,
      eliteMatchesToday,
      eliteTotalPlayers
    };
    res.json(stats);
  } catch (err) {
    console.error("Error en /elite/stats:", err);
    res.status(500).json({ error: "Error del servidor" });
  }
});

eliteRouter.get("/queue", async (req, res) => {
  try {
    const queueDoc = await queuesCollection.findOne({ _id: "globalQueues" });
    const elitePlayers = queueDoc?.elite || [];
    const playersInQueue = await usersCollection.find({ discordId: { $in: elitePlayers } }).toArray();
    res.json(playersInQueue.map(p => ({
      id: p.discordId,
      username: p.username,
      avatarURL: p.avatarURL,
      roles: p.roles || []
    })));
  } catch (err) {
    console.error("Error en /elite/queue:", err);
    res.status(500).json({ error: "Error del servidor" });
  }
});

eliteRouter.get("/matches", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || ITEMS_PER_PAGE;
    const skip = (page - 1) * limit;

    const totalMatches = await matchesCollection.countDocuments({ matchType: "elite", statsStatus: "completed" });
    const matches = await matchesCollection.find({ matchType: "elite", statsStatus: "completed" })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    res.json({
      matches,
      totalMatches,
      page,
      pages: Math.ceil(totalMatches / limit)
    });
  } catch (err) {
    console.error("Error en /elite/matches:", err);
    res.status(500).json({ error: "Error del servidor" });
  }
});

eliteRouter.get("/leaderboard", async (req, res) => {
  try {
    const users = await usersCollection.find({ isAuthorized: true }, { projection: { "discordSession": 0, "stats.public": 0 } }).toArray();
    const leaderboard = users.map(u => ({
      id: u.discordId,
      username: u.username,
      riotId: u.riotId || "",
      roles: u.roles || [],
      avatarURL: u.avatarURL,
      stats: u.stats?.elite || {},
      score: u.stats?.elite?.score || 0
    })).sort((a, b) => b.score - a.score);
    res.json(leaderboard);
  } catch (err) {
    console.error("Error en /elite/leaderboard:", err);
    res.status(500).json({ error: "Error del servidor" });
  }
});

eliteRouter.get("/mymatches", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || ITEMS_PER_PAGE;
    const skip = (page - 1) * limit;

    const query = { "players.id": userId, matchType: "elite", statsStatus: "completed" };
    
    const totalMatches = await matchesCollection.countDocuments(query);
    const matches = await matchesCollection.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    res.json({
      matches,
      totalMatches,
      page,
      pages: Math.ceil(totalMatches / limit)
    });
  } catch (err) {
    console.error("Error en /elite/mymatches:", err);
    res.status(500).json({ error: "Error del servidor" });
  }
});

// ---
// Rutas de Queues (queues)
// ---
const MAPS = ["Ascent", "Bind", "Haven", "Icebox", "Breeze", "split", "Fracture", "Pearl", "Lotus", "Sunset", "Abyss", "Corrode"];
const SIDES = ["Attacker", "Defender"];

async function joinQueue(userId, matchType) {
  let queueDoc = await queuesCollection.findOne({ _id: "globalQueues" });
  if (!queueDoc) {
    queueDoc = { _id: "globalQueues", public: [], elite: [] };
    if (matchType === "public") queueDoc.public.push(userId);
    else if (matchType === "elite") queueDoc.elite.push(userId);
    await queuesCollection.insertOne(queueDoc);
  } else {
    const queueToUpdate = queueDoc[matchType];
    if (!queueToUpdate.includes(userId)) {
      await queuesCollection.updateOne(
        { _id: "globalQueues" },
        { $addToSet: { [matchType]: userId } }
      );
      queueToUpdate.push(userId);
    }
  }

  const queue = queueDoc[matchType];
  if (queue.length === 10) {
    const playersForMatch = queue.slice(0, 10);
    await queuesCollection.updateOne(
      { _id: "globalQueues" },
      { $pull: { [matchType]: { $in: playersForMatch } } }
    );

    const map = MAPS[Math.floor(Math.random() * MAPS.length)];
    const shuffled = [...playersForMatch].sort(() => 0.5 - Math.random());
    const teamAIds = shuffled.slice(0, 5);
    const teamBIds = shuffled.slice(5, 10);

    const fetchUsers = async (ids) => {
      const users = await usersCollection.find({ discordId: { $in: ids } }).toArray();
      return ids.map(id => {
        const user = users.find(u => u.discordId === id);
        return {
          id: user.discordId,
          username: user.username,
          avatar: user.avatarURL,
          riotId: user.riotId || null,
          roles: user.roles || [],
          character: null, ACS: 0, kills: 0, deaths: 0, assists: 0, hsPercent: 0, FK: 0, FD: 0, MK: 0, KAST: 0, ADR: 0, DDDelta: 0, score: 0
        };
      });
    };

    const teamA = await fetchUsers(teamAIds);
    const teamB = await fetchUsers(teamBIds);
    const leaderId = playersForMatch[Math.floor(Math.random() * playersForMatch.length)];
    const leaderUser = await usersCollection.findOne({ discordId: leaderId });

    const newMatch = {
      matchType,
      season: 2,
      status: "pending",
      statsStatus: "pending",
      players: playersForMatch,
      teamA,
      teamB,
      map,
      leader: {
        id: leaderUser.discordId,
        username: leaderUser.username,
        avatar: leaderUser.avatarURL,
        riotId: leaderUser.riotId || null,
      },
      startingSides: {
        teamA: SIDES[Math.floor(Math.random() * SIDES.length)],
        teamB: SIDES[Math.floor(Math.random() * SIDES.length)],
      },
      createdAt: new Date(),
    };
    const result = await matchesCollection.insertOne(newMatch);
    return { ...newMatch, _id: result.insertedId };
  }
  return null;
}

apiRouter.post("/queue/join", requireAuth, async (req, res) => {
  try {
    const { matchType } = req.body;
    const userId = req.session.userId;

    const user = await usersCollection.findOne({ discordId: userId });

    if (!user || !user.riotId || !user.name || !user.tag) {
      return res.status(403).json({ error: "Debes registrar tu Riot ID en tu perfil para unirte a cualquier cola." });
    }

    if (matchType === "elite" && !user.isAuthorized) {
      return res.status(403).json({ error: "No estás autorizado para unirte a la cola de élite." });
    }

    const queueDoc = await queuesCollection.findOne({ _id: "globalQueues" });
    const inQueue = queueDoc?.public.includes(userId) || queueDoc?.elite.includes(userId);
    if (inQueue) return res.status(400).json({ error: "Ya estás en una cola." });

    const newMatch = await joinQueue(userId, matchType);
    if (newMatch) return res.json({ success: true, match: newMatch, message: "Partida iniciada automáticamente" });

    res.json({ success: true, message: `Jugador agregado a la cola ${matchType}` });
  } catch (err) {
    console.error("Error en /queue/join:", err);
    res.status(500).json({ error: "Error del servidor" });
  }
});

apiRouter.post("/queue/leave", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const result = await queuesCollection.updateOne(
      { _id: "globalQueues" },
      { $pull: { public: userId, elite: userId } }
    );
    if (result.modifiedCount === 0) return res.status(404).json({ error: "No estabas en la cola" });
    res.json({ success: true, message: "Has salido de la cola" });
  } catch (err) {
    console.error("Error en /queue/leave:", err);
    res.status(500).json({ error: "Error del servidor" });
  }
});

apiRouter.get("/queue/my-status", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const match = await matchesCollection.findOne({ "players.id": userId, status: { $in: ["pending", "active"] } });
    if (match) return res.json({ inQueue: false, match });

    const queueDoc = await queuesCollection.findOne({ _id: "globalQueues" });
    const inPublicQueue = queueDoc?.public.includes(userId);
    const inEliteQueue = queueDoc?.elite.includes(userId);
    res.json({ inQueue: inPublicQueue || inEliteQueue, inPublicQueue, inEliteQueue });
  } catch (err) {
    console.error("Error en /queue/my-status:", err);
    res.status(500).json({ error: "Error del servidor" });
  }
});

// ---
// Rutas Generales
// ---
apiRouter.get("/leaderboard", async (req, res) => {
  try {
    const users = await usersCollection.find({}, { projection: { "discordSession": 0 } }).toArray();
    const formattedUsers = users.map(u => {
      const stats = u.stats?.public || {};
      const matches = stats.matchesPlayed || 1;
      return {
        ...u,
        avgACS: matches ? (stats.totalACS / matches) : 0,
        avgFK: matches ? (stats.totalFK / matches) : 0,
        avgADR: matches ? (stats.totalADR / matches) : 0,
        avgDDDelta: matches ? (stats.totalDDDelta / matches) : 0,
        avgKAST: matches ? (stats.totalKAST / matches) : 0,
        hsPercent: stats.totalKills ? (stats.totalHeadshotKills / stats.totalKills * 100) : 0,
        score: stats.score || 0,
      };
    });
    formattedUsers.sort((a, b) => b.score - a.score);
    res.json(formattedUsers);
  } catch (err) {
    console.error("Error en /leaderboard:", err);
    res.status(500).json({ error: "Error generando leaderboard" });
  }
});

apiRouter.get("/matches/latest", async (req, res) => {
  try {
    const latestMatch = await matchesCollection.find().sort({ createdAt: -1 }).limit(1).toArray();
    res.json(latestMatch[0] || null);
  } catch (err) {
    console.error("Error en /matches/latest:", err);
    res.status(500).json({ error: "Error al obtener última partida" });
  }
});

// ---
// Rutas de administración
// ---
apiRouter.get("/admin/users", requireAdmin, async (req, res) => {
  try {
    const users = await usersCollection.find().toArray();
    res.json(users);
  } catch (err) {
    console.error("Error en GET /admin/users:", err);
    res.status(500).json({ error: "Error al obtener usuarios" });
  }
});

apiRouter.put("/admin/users/:discordId", requireAdmin, async (req, res) => {
  try {
    const { discordId } = req.params;
    const { isAdmin, isAuthorized } = req.body;
    const result = await usersCollection.updateOne(
      { discordId },
      { $set: { isAdmin, isAuthorized } }
    );
    if (result.matchedCount === 0) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json({ message: "Usuario actualizado" });
  } catch (err) {
    console.error("Error en PUT /admin/users/:discordId:", err);
    res.status(500).json({ error: "Error actualizando usuario" });
  }
});

apiRouter.delete("/admin/users/:discordId", requireAdmin, async (req, res) => {
  try {
    const { discordId } = req.params;
    const result = await usersCollection.deleteOne({ discordId });
    if (result.deletedCount === 0) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json({ message: "Usuario eliminado" });
  } catch (err) {
    console.error("Error en DELETE /admin/users/:discordId:", err);
    res.status(500).json({ error: "Error eliminando usuario" });
  }
});

apiRouter.get("/admin/matches", requireAdmin, async (req, res) => {
  try {
    const matches = await matchesCollection.find().sort({ createdAt: -1 }).toArray();
    res.json(matches);
  } catch (err) {
    console.error("Error en GET /admin/matches:", err);
    res.status(500).json({ error: "Error obteniendo partidas" });
  }
});

apiRouter.post("/admin/matches/submit-stats", requireAdmin, async (req, res) => {
  try {
    const { matchId, winnerTeam, score, playerStats } = req.body;
    if (!matchId || !winnerTeam || !score || !Array.isArray(playerStats)) return res.status(400).json({ error: "Datos de stats incompletos" });

    const match = await matchesCollection.findOne({ _id: new ObjectId(matchId) });
    if (!match) return res.status(404).json({ error: "Partida no encontrada" });
    if (match.statsStatus === "completed") return res.status(403).json({ error: "Las estadísticas de esta partida ya fueron procesadas." });

    const updatedPlayers = {};
    for (const p of playerStats) {
      const { id, character, kills, deaths, assists, ...stats } = p;
      const didWin = (match.teamA.find(pl => pl.id === id) && winnerTeam === "A") || (match.teamB.find(pl => pl.id === id) && winnerTeam === "B");
      const teamStats = (match.teamA.find(pl => pl.id === id)) ? match.teamA : match.teamB;
      const { totalScore } = calculateMatchScore(p, didWin ? winnerTeam : (winnerTeam === "A" ? "B" : "A"), teamStats, didWin);

      const headshotsThisMatch = Math.round((stats.hsPercent / 100) * kills);
      const updatePath = `stats.${match.matchType}`;

      await usersCollection.updateOne(
        { discordId: id },
        {
          $inc: {
            [`${updatePath}.matchesPlayed`]: 1,
            [`${updatePath}.wins`]: didWin ? 1 : 0,
            [`${updatePath}.totalKills`]: kills,
            [`${updatePath}.totalDeaths`]: deaths,
            [`${updatePath}.totalAssists`]: assists,
            [`${updatePath}.totalACS`]: stats.ACS,
            [`${updatePath}.totalDDDelta`]: stats.DDDelta,
            [`${updatePath}.totalADR`]: stats.ADR,
            [`${updatePath}.totalHeadshotKills`]: headshotsThisMatch,
            [`${updatePath}.totalKAST`]: stats.KAST,
            [`${updatePath}.totalFK`]: stats.FK,
            [`${updatePath}.totalFD`]: stats.FD,
            [`${updatePath}.totalMK`]: stats.MK,
            [`${updatePath}.score`]: totalScore
          },
        },
        { upsert: true }
      );
      updatedPlayers[id] = { character, ...stats };
    }

    await matchesCollection.updateOne(
      { _id: new ObjectId(matchId) },
      {
        $set: {
          winnerTeam,
          score,
          statsStatus: "completed",
          teamA: match.teamA.map(p => ({ ...p, ...updatedPlayers[p.id] })),
          teamB: match.teamB.map(p => ({ ...p, ...updatedPlayers[p.id] })),
        },
      }
    );
    res.json({ message: "Estadísticas de la partida subidas y perfiles de usuario actualizados." });
  } catch (err) {
    console.error("Error en /admin/matches/submit-stats:", err);
    res.status(500).json({ error: "Error del servidor" });
  }
});

// Asignar enrutadores
app.use("/api/public", publicRouter);
app.use("/api/elite", eliteRouter);
app.use("/api", apiRouter);

// Rutas de administración de archivos estáticos
app.get("/admin/login", (req, res) => res.sendFile(path.join(__dirname, "private/login.html")));
app.get("/check-session", async (req, res) => {
  if (!req.session?.userId) return res.json({ loggedIn: false, isAdmin: false });
  const user = await usersCollection.findOne({ discordId: req.session.userId });
  res.json({ loggedIn: true, isAdmin: user?.isAdmin || false });
});

app.get("/admin", requireAdmin, (req, res) => res.sendFile(path.join(__dirname, "private/admin.html")));

app.post("/logout", (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: "Error cerrando sesión" });
    res.clearCookie("connect.sid");
    res.json({ success: true, message: "Sesión cerrada" });
  });
});

// Iniciar servidor
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Servidor escuchando en el puerto ${PORT}`);
  });
});
