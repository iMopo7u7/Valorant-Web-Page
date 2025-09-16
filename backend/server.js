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
// Discord OAuth
// ==========================
const apiRouter = express.Router();

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
app.use("/api", apiRouter);

// Rutas de Usuarios (users)
apiRouter.get("/users/me", requireAuth, async (req, res) => {
  try {
    const user = await usersCollection.findOne({ discordId: req.session.userId }, { projection: { "discordSession": 0 } });
    if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json(user);
  } catch (err) {
    console.error("Error en /users/me:", err);
    res.status(500).json({ error: "Error del servidor" });
  }
});

apiRouter.post("/users/update-riot", requireAuth, async (req, res) => {
  try {
    const { riotId, name, tag } = req.body;
    const userId = req.session.userId;
    if (!riotId || !name || !tag) return res.status(400).json({ error: "Debes enviar un Riot ID, nombre y tag" });

    const user = await usersCollection.findOne({ discordId: userId });
    if (!user) return res.status(404).json({ error: "Usuario no encontrado" });

    await usersCollection.updateOne(
      { discordId: userId },
      { $set: { riotId, name, tag, updatedAt: new Date() } }
    );
    res.json({ success: true, riotId });
  } catch (err) {
    console.error("Error en /users/update-riot:", err);
    res.status(500).json({ error: "Error del servidor" });
  }
});

apiRouter.get("/users/all", async (req, res) => {
  try {
    const users = await usersCollection.find({}, { projection: { "discordSession": 0 } }).toArray();
    const sortedUsers = users.sort((a, b) => (b.stats?.public?.score || 0) - (a.stats?.public?.score || 0));
    res.json(sortedUsers);
  } catch (err) {
    console.error("Error en /users/all:", err);
    res.status(500).json({ error: "Error del servidor" });
  }
});

apiRouter.post("/users/setup", requireAuth, async (req, res) => {
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
                    updatedAt: new Date()
                }
            }
        );

        const user = await usersCollection.findOne({ discordId: userId });
        res.json(user);
    } catch (err) {
        console.error("Error en /users/setup:", err);
        res.status(500).json({ error: "Error del servidor" });
    }
});

// Rutas de Queues
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

apiRouter.get("/queues", async (req, res) => {
  try {
    const queues = await queuesCollection.findOne({ _id: "globalQueues" });
    if (!queues) return res.json({ public: [], elite: [] });

    const publicPlayers = await usersCollection.find({ discordId: { $in: queues.public } }).toArray();
    const elitePlayers = await usersCollection.find({ discordId: { $in: queues.elite } }).toArray();

    res.json({
      public: publicPlayers.map(p => ({ id: p.discordId, username: p.username, avatarURL: p.avatarURL })),
      elite: elitePlayers.map(p => ({ id: p.discordId, username: p.username, avatarURL: p.avatarURL })),
    });
  } catch (err) {
    console.error("Error en /queues:", err);
    res.status(500).json({ error: "Error del servidor" });
  }
});

// Rutas de Stats
apiRouter.get("/stats/public", async (req, res) => {
  try {
    const users = await usersCollection.find({}, { projection: { discordSession: 0 } }).toArray();
    const stats = users.map(u => {
      const s = u.stats?.public || {};
      return {
        id: u.discordId,
        username: u.username,
        riotId: u.riotId || "",
        matches: s.matchesPlayed || 0,
        wins: s.wins || 0,
        score: s.score || 0,
        avgACS: s.matchesPlayed ? (s.totalACS / s.matchesPlayed) : 0,
        avgADR: s.matchesPlayed ? (s.totalADR / s.matchesPlayed) : 0,
        avgKAST: s.matchesPlayed ? (s.totalKAST / s.matchesPlayed) : 0,
        hsPercent: s.totalKills ? (s.totalHeadshotKills / s.totalKills * 100) : 0,
      };
    });
    res.json(stats);
  } catch (err) {
    console.error("Error en /stats/public:", err);
    res.status(500).json({ error: "Error generando estadísticas públicas" });
  }
});

apiRouter.get("/stats/premier", async (req, res) => {
  try {
    const users = await usersCollection.find({}, { projection: { discordSession: 0 } }).toArray();
    const stats = users.map(u => {
      const s = u.stats?.elite || {}; // premier = cola élite
      return {
        id: u.discordId,
        username: u.username,
        riotId: u.riotId || "",
        matches: s.matchesPlayed || 0,
        wins: s.wins || 0,
        score: s.score || 0,
        avgACS: s.matchesPlayed ? (s.totalACS / s.matchesPlayed) : 0,
        avgADR: s.matchesPlayed ? (s.totalADR / s.matchesPlayed) : 0,
        avgKAST: s.matchesPlayed ? (s.totalKAST / s.matchesPlayed) : 0,
        hsPercent: s.totalKills ? (s.totalHeadshotKills / s.totalKills * 100) : 0,
      };
    });
    res.json(stats);
  } catch (err) {
    console.error("Error en /stats/premier:", err);
    res.status(500).json({ error: "Error generando estadísticas premier" });
  }
});

// Rutas de Matches
apiRouter.get("/matches", async (req, res) => {
  try {
    const matches = await matchesCollection.find().sort({ createdAt: -1 }).toArray();
    res.json(matches);
  } catch (err) {
    console.error("Error en GET /matches:", err);
    res.status(500).json({ error: "Error obteniendo partidas" });
  }
});

apiRouter.get("/matches/:id", async (req, res) => {
  try {
    const match = await matchesCollection.findOne({ _id: new ObjectId(req.params.id) });
    if (!match) return res.status(404).json({ error: "Partida no encontrada" });
    res.json(match);
  } catch (err) {
    console.error("Error en GET /matches/:id:", err);
    res.status(500).json({ error: "Error del servidor" });
  }
});

apiRouter.post("/matches/submit-room", requireAuth, async (req, res) => {
  try {
    const { matchId, roomCode } = req.body;
    const userId = req.session.userId;
    if (!matchId || !roomCode) return res.status(400).json({ error: "Faltan matchId o roomCode" });

    const match = await matchesCollection.findOne({ _id: new ObjectId(matchId), "leader.id": userId });
    if (!match) return res.status(404).json({ error: "No se encontró partida activa para asignar roomCode" });

    await matchesCollection.updateOne(
      { _id: new ObjectId(matchId) },
      { $set: { roomCode, status: "active" } }
    );
    res.json({ success: true, roomCode });
  } catch (err) {
    console.error("Error en /matches/submit-room:", err);
    res.status(500).json({ error: "Error del servidor" });
  }
});

apiRouter.post("/matches/submit-tracker", requireAuth, async (req, res) => {
  try {
    const { matchId, trackerUrl } = req.body;
    const userId = req.session.userId;
    if (!matchId || !trackerUrl) return res.status(400).json({ error: "Faltan matchId o trackerUrl" });

    const match = await matchesCollection.findOne({ _id: new ObjectId(matchId), "leader.id": userId });
    if (!match) return res.status(404).json({ error: "No se encontró partida activa para asignar trackerUrl" });
    if (match.trackerUrl) return res.status(403).json({ error: "El tracker ya fue enviado y no se puede cambiar" });

    await matchesCollection.updateOne(
      { _id: new ObjectId(matchId) },
      { $set: { trackerUrl, status: "finished", finishedAt: new Date() } }
    );
    res.json({ success: true, trackerUrl });
  } catch (err) {
    console.error("Error en /matches/submit-tracker:", err);
    res.status(500).json({ error: "Error del servidor" });
  }
});

apiRouter.post("/matches/submit-stats", requireAdmin, async (req, res) => {
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
    console.error("Error en /matches/submit-stats:", err);
    res.status(500).json({ error: "Error del servidor" });
  }
});

// Rutas de Admin
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

// Rutas de Leaderboard y misceláneas
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
    res.clearCookie('connect.sid');
    res.json({ message: "Sesión cerrada" });
  });
});


// ==============================
// 📑 Rutas de documentación
// ==============================
app.get("/api/docs", (req, res) => {
    const routes = [
        // ==== USERS ====
        { method: "GET", path: "/api/users/me", auth: "requireAuth", desc: "Obtiene perfil del usuario actual" },
        { method: "PUT", path: "/api/users/setup", auth: "requireAuth", desc: "Configura rol y Riot ID en el registro" },
        { method: "PUT", path: "/api/users/riotid", auth: "requireAuth", desc: "Actualiza Riot ID" },
        { method: "GET", path: "/api/users", auth: "admin", desc: "Lista todos los usuarios" },

        // ==== QUEUES ====
        { method: "POST", path: "/api/queue/join", auth: "requireAuth", desc: "Unirse a la cola" },
        { method: "POST", path: "/api/queue/leave", auth: "requireAuth", desc: "Salir de la cola" },
        { method: "GET", path: "/api/queue/status", auth: "requireAuth", desc: "Ver estado de la cola del usuario" },
        { method: "GET", path: "/api/queue", auth: "public", desc: "Lista jugadores en cola" },

        // ==== MATCHES ====
        { method: "GET", path: "/api/matches", auth: "requireAuth", desc: "Lista todas las partidas" },
        { method: "GET", path: "/api/matches/:id", auth: "requireAuth", desc: "Obtener partida por ID" },
        { method: "POST", path: "/api/matches/:id/room", auth: "requireAuth", desc: "Enviar link de sala personalizada" },
        { method: "POST", path: "/api/matches/:id/tracker", auth: "requireAuth", desc: "Enviar link de tracker" },
        { method: "POST", path: "/api/matches/:id/stats", auth: "requireAuth", desc: "Subir estadísticas finales de la partida" },

        // ==== STATS ====
        { method: "GET", path: "/api/stats/public", auth: "public", desc: "Estadísticas públicas de los jugadores" },
        { method: "GET", path: "/api/stats/premier", auth: "public", desc: "Estadísticas de Premier (élite)" },

        // ==== ADMIN ====
        { method: "GET", path: "/api/admin/users", auth: "admin", desc: "Lista todos los usuarios (admin)" },
        { method: "PUT", path: "/api/admin/users/:id/permissions", auth: "admin", desc: "Actualizar permisos de un usuario" },
        { method: "DELETE", path: "/api/admin/users/:id", auth: "admin", desc: "Eliminar un usuario" },

        // ==== AUTH ====
        { method: "GET", path: "/api/auth/discord", auth: "public", desc: "Login con Discord OAuth2" },
        { method: "GET", path: "/api/auth/discord/callback", auth: "public", desc: "Callback de Discord OAuth2" },
        { method: "POST", path: "/api/auth/logout", auth: "requireAuth", desc: "Cerrar sesión" },
    ];

    // Render simple HTML
    const html = `
        <html>
            <head>
                <title>📑 API Docs</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 20px; }
                    table { border-collapse: collapse; width: 100%; }
                    th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
                    th { background: #f2f2f2; }
                </style>
            </head>
            <body>
                <h1>📑 Documentación de la API</h1>
                <table>
                    <thead>
                        <tr>
                            <th>Método</th>
                            <th>Ruta</th>
                            <th>Auth</th>
                            <th>Descripción</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${routes.map(r => `
                            <tr>
                                <td><b>${r.method}</b></td>
                                <td>${r.path}</td>
                                <td>${r.auth}</td>
                                <td>${r.desc}</td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            </body>
        </html>
    `;
    res.send(html);
});

// ==========================
// Manejo de errores global y servidor
// ==========================
app.use((req, res) => res.status(404).json({ error: "Endpoint no encontrado" }));

connectDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));
}).catch(err => {
  console.error("❌ Error iniciando servidor:", err);
  process.exit(1);
});
