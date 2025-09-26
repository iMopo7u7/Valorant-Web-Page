import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv";
import session from "express-session";
import MongoStore from "connect-mongo";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch"; // Si estás usando Node 18+ puedes usar fetch nativo

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

app.set("trust proxy", 1);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(express.json());

// ==========================
// Sesiones con MongoStore
// ==========================
const sessionStore = MongoStore.create({
  mongoUrl: process.env.MONGODB_URI,
  collectionName: "sessions",
  ttl: 7 * 24 * 60 * 60, // 7 días
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

async function requireAdmin(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: "No autorizado" });
  const user = await usersCollection.findOne({ discordId: req.session.userId });
  if (user && user.isAdmin) next();
  else res.status(403).json({ error: "Acceso denegado" });
}

// ==========================
// Función para obtener token de Discord
// ==========================
async function fetchDiscordToken(params) {
  const response = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params
  });
  if (!response.ok) throw new Error("Error obteniendo token de Discord");
  return response.json();
}

// ==========================
// RUTA: Discord OAuth Callback
// ==========================
app.get("/auth/discord/callback", async (req, res) => {
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

    const defaultStats = {
      matchesPlayed: 0,
      wins: 0,
      totalKills: 0,
      totalDeaths: 0,
      totalAssists: 0,
      totalACS: 0,
      totalADR: 0,
      totalDDDelta: 0,
      totalHeadshotKills: 0,
      totalKAST: 0,
      totalFK: 0,
      totalFD: 0,
      totalMK: 0,
      score: 0
    };

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
          roles: [],
          riotId: null,
          region: "LAS",
          stats: {
            public: { ...defaultStats },
            elite: { ...defaultStats }
          },
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
// RUTAS DE COLAS Y MATCHES
// ==========================
const apiRouter = express.Router();

// ----- COLAS -----
apiRouter.get("/queue/:type/:region", async (req, res) => {
  const { type, region } = req.params;
  try {
    const queueDoc = await queuesCollection.findOne({});
    if (!queueDoc || !queueDoc[type]?.[region]) return res.json([]);
    res.json(queueDoc[type][region]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error obteniendo la cola" });
  }
});

apiRouter.post("/queue/join", requireAuth, async (req, res) => {
  const { userId, type, region } = req.body;
  try {
    const user = await usersCollection.findOne({ discordId: userId });
    if (!user || !user.riotId) return res.status(400).json({ error: "Usuario no autorizado o sin Riot ID" });

    const queueDoc = await queuesCollection.findOne({});
    const isInQueue =
      ["public", "elite"].some(qType =>
        ["LAN", "LAS"].some(r =>
          queueDoc?.[qType]?.[r]?.some(p => p.discordId === userId)
        )
      );
    if (isInQueue) return res.status(400).json({ error: "Usuario ya está en otra cola" });

    const newPlayer = { discordId: user.discordId, roles: user.roles, joinedAt: new Date() };

    await queuesCollection.updateOne(
      {},
      { $push: { [`${type}.${region}`]: newPlayer } },
      { upsert: true }
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al unirse a la cola" });
  }
});

apiRouter.post("/queue/leave", requireAuth, async (req, res) => {
  const { userId, type, region } = req.body;
  try {
    await queuesCollection.updateOne(
      {},
      { $pull: { [`${type}.${region}`]: { discordId: userId } } }
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al salir de la cola" });
  }
});

apiRouter.post("/queue/confirm-player", async (req, res) => {
  const { userId, type, region, active } = req.body;
  try {
    await queuesCollection.updateOne(
      {},
      { $set: { [`${type}.${region}.$[elem].active`]: active } },
      { arrayFilters: [{ "elem.discordId": userId }] }
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error confirmando jugador" });
  }
});

// ----- MATCHES -----
// ----- MATCHES -----
apiRouter.post("/match/create", async (req, res) => {
  const { type, region } = req.body;

  try {
    const queueDoc = await queuesCollection.findOne({});
    let queue = queueDoc?.[type]?.[region] || [];

    if (queue.length < 10) return res.status(400).json({ error: "No hay suficientes jugadores en cola" });

    // Tomamos los primeros 10
    queue = shuffleArray(queue);
    let playersForMatch = queue.slice(0, 10);

    if (type === "elite") {
      // Contamos roles
      const roleCounts = { duelista: 0, iniciador: 0, controlador: 0, centinela: 0, flex: 0 };
      playersForMatch.forEach(p => p.roles.forEach(r => {
        if (roleCounts[r] !== undefined) roleCounts[r]++;
      }));

      // Verificamos que haya al menos 2 de cada rol
      if (Object.values(roleCounts).some(count => count < 2)) {
        return res.status(400).json({ error: "No hay suficientes jugadores por rol para crear match elite" });
      }

      // Asignamos equipos balanceados
      const teams = { teamA: [], teamB: [] };
      const rolesNeeded = ["duelista", "iniciador", "controlador", "centinela", "flex"];
      
      for (const role of rolesNeeded) {
        const playersWithRole = playersForMatch.filter(p => p.roles.includes(role));
        shuffleArray(playersWithRole); // aleatorio
        teams.teamA.push(playersWithRole[0]);
        teams.teamB.push(playersWithRole[1]);
      }

      // Quitamos los 10 seleccionados de playersForMatch para no duplicar
      const selectedIds = [...teams.teamA, ...teams.teamB].map(p => p.discordId);
      const remainingPlayers = playersForMatch.filter(p => !selectedIds.includes(p.discordId));

      // Repartimos los restantes (flex/random)
      teams.teamA.push(remainingPlayers[0], remainingPlayers[1]);
      teams.teamB.push(remainingPlayers[2], remainingPlayers[3]);

      playersForMatch = [...shuffleArray(teams.teamA), ...shuffleArray(teams.teamB)];
    }

    const match = {
      type,
      region,
      matchType: type,
      players: playersForMatch.map(p => ({ discordId: p.discordId, roles: p.roles, accepted: false })),
      map: getRandomMap(),
      sides: assignRandomSides(),
      status: "pending",
      createdAt: new Date()
    };

    const result = await matchesCollection.insertOne(match);

    res.json({ success: true, matchId: result.insertedId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Error creando match" });
  }
});

apiRouter.post("/match/confirm", requireAuth, async (req, res) => {
  const { matchId, userId, accepted } = req.body;

  try {
    const match = await matchesCollection.findOne({ _id: new ObjectId(matchId) });
    if (!match) return res.status(404).json({ error: "Match no encontrado" });

    // Actualizamos confirmación del jugador
    await matchesCollection.updateOne(
      { _id: match._id, "players.discordId": userId },
      { $set: { "players.$.accepted": accepted } }
    );

    const updatedMatch = await matchesCollection.findOne({ _id: match._id });
    const allAccepted = updatedMatch.players.every(p => p.accepted);
    const someRejected = updatedMatch.players.some(p => p.accepted === false);

    if (allAccepted) {
      // Todos aceptaron: se eliminan de la cola y activamos la partida
      for (const p of updatedMatch.players) {
        await queuesCollection.updateOne(
          {},
          { $pull: { [`${updatedMatch.type}.${updatedMatch.region}`]: { discordId: p.discordId } } }
        );
      }
      await matchesCollection.updateOne({ _id: match._id }, { $set: { status: "active" } });
    } else if (someRejected) {
      // Al menos alguien rechazó: sacamos solo al que rechazó y devolvemos los demás a la cola
      const rejectedPlayers = updatedMatch.players.filter(p => p.accepted === false);
      const acceptedPlayers = updatedMatch.players.filter(p => p.accepted !== false);

      // Eliminamos del match los rechazados
      await matchesCollection.updateOne(
        { _id: match._id },
        { $pull: { players: { discordId: { $in: rejectedPlayers.map(p => p.discordId) } } } }
      );

      // Eliminamos del queue solo a los rechazados y reinsertamos los aceptados si no están
      for (const r of rejectedPlayers) {
        await queuesCollection.updateOne(
          {},
          { $pull: { [`${updatedMatch.type}.${updatedMatch.region}`]: { discordId: r.discordId } } }
        );
      }

      for (const a of acceptedPlayers) {
        const queueDoc = await queuesCollection.findOne({});
        const exists = queueDoc?.[updatedMatch.type]?.[updatedMatch.region]?.some(p => p.discordId === a.discordId);
        if (!exists) {
          await queuesCollection.updateOne(
            {},
            { $push: { [`${updatedMatch.type}.${updatedMatch.region}`]: { discordId: a.discordId, roles: a.roles, joinedAt: new Date() } } }
          );
        }
      }

      await matchesCollection.updateOne({ _id: match._id }, { $set: { status: "cancelled" } });
    }

    res.json({ success: true, allAccepted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error confirmando match" });
  }
});

apiRouter.post("/admin/matches/submit-stats", requireAdmin, async (req, res) => {
  try {
    const { matchId, winnerTeam, score, playerStats } = req.body;
    if (!matchId || !winnerTeam || !score || !Array.isArray(playerStats)) {
      return res.status(400).json({ error: "Datos de stats incompletos" });
    }

    const match = await matchesCollection.findOne({ _id: new ObjectId(matchId) });
    if (!match) return res.status(404).json({ error: "Partida no encontrada" });
    if (match.statsStatus === "completed") return res.status(403).json({ error: "Las estadísticas ya fueron procesadas." });

    const updatedPlayers = {};

    for (const p of playerStats) {
      const { id, character, kills, deaths, assists, ACS, KAST, ADR, DDDelta, FK, FD, MK, hsPercent } = p;
      const didWin = (match.players.slice(0,5).find(pl => pl.discordId === id) && winnerTeam === "A") ||
                     (match.players.slice(5,10).find(pl => pl.discordId === id) && winnerTeam === "B");
      
      const teamStats = match.players.slice(didWin ? 0 : 5, didWin ? 5 : 10); // Aproximación
      
      const { totalScore } = calculateMatchScore(p, didWin ? winnerTeam : (winnerTeam === "A" ? "B" : "A"), teamStats, didWin);
      const headshotsThisMatch = Math.round((hsPercent / 100) * kills);

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
            [`${updatePath}.totalACS`]: ACS,
            [`${updatePath}.totalDDDelta`]: DDDelta,
            [`${updatePath}.totalADR`]: ADR,
            [`${updatePath}.totalHeadshotKills`]: headshotsThisMatch,
            [`${updatePath}.totalKAST`]: KAST,
            [`${updatePath}.totalFK`]: FK,
            [`${updatePath}.totalFD`]: FD,
            [`${updatePath}.totalMK`]: MK,
            [`${updatePath}.score`]: totalScore
          }
        },
        { upsert: true }
      );

      updatedPlayers[id] = { character, kills, deaths, assists, ACS, KAST, ADR, DDDelta, FK, FD, MK, hsPercent, totalScore };
    }

    await matchesCollection.updateOne(
      { _id: new ObjectId(matchId) },
      {
        $set: {
          winnerTeam,
          score,
          statsStatus: "completed",
          players: match.players.map(p => ({ ...p, ...updatedPlayers[p.discordId] }))
        }
      }
    );

    res.json({ message: "Estadísticas de la partida subidas y perfiles de usuario actualizados." });
  } catch (err) {
    console.error("Error en /admin/matches/submit-stats:", err);
    res.status(500).json({ error: "Error del servidor" });
  }
});

// ==========================
// FUNCIONES AUXILIARES
// ==========================
function shuffleArray(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function getRandomMap() {
  const maps = ["Bind", "Haven", "Split", "Ascent", "Icebox"];
  return maps[Math.floor(Math.random() * maps.length)];
}

function assignRandomSides() {
  return Math.random() > 0.5
    ? { teamA: "attack", teamB: "defense" }
    : { teamA: "defense", teamB: "attack" };
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
// Montar router y levantar servidor
// ==========================
app.use("/api", apiRouter);

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Servidor escuchando en el puerto ${PORT}`);
  });
});
