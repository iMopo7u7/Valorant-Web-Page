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

let db, playersCollection, matchesCollection, usersCollection, customMatchesCollection;

async function connectDB() {
  try {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    db = client.db("valorantDB");
    playersCollection = db.collection("players");
    matchesCollection = db.collection("matches");
    usersCollection = db.collection("users");
    customMatchesCollection = db.collection("customMatches");
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

async function refreshDiscordToken(user) {
  const params = new URLSearchParams();
  params.append("client_id", process.env.DISCORD_CLIENT_ID);
  params.append("client_secret", process.env.DISCORD_CLIENT_SECRET);
  params.append("grant_type", "refresh_token");
  params.append("refresh_token", user.refreshToken);
  params.append("redirect_uri", process.env.DISCORD_REDIRECT_URI);
  return await fetchDiscordToken(params);
}

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

    const user = {
      discordId: discordUser.id,
      username: discordUser.username,
      discriminator: discordUser.discriminator,
      avatar: discordUser.avatar,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      tokenExpiresAt: Date.now() + (tokenData.expires_in * 1000),
      updatedAt: new Date()
    };

    await usersCollection.updateOne({ discordId: discordUser.id }, { $set: user }, { upsert: true });
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

async function requireAuthDiscord(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "No autorizado" });

  const user = await usersCollection.findOne({ discordId: req.session.userId });
  if (!user) return res.status(401).json({ error: "Usuario no encontrado" });

  if (Date.now() > user.tokenExpiresAt) {
    try {
      const tokenData = await refreshDiscordToken(user);
      await usersCollection.updateOne(
        { discordId: user.discordId },
        { $set: { accessToken: tokenData.access_token, refreshToken: tokenData.refresh_token, tokenExpiresAt: Date.now() + (tokenData.expires_in * 1000) } }
      );
      user.accessToken = tokenData.access_token;
    } catch (err) {
      console.error("Error refrescando token:", err);
      return res.status(401).json({ error: "Token expirado, vuelve a loguearte" });
    }
  }

  req.user = user;
  next();
}

// ==========================
// Users endpoints
// ==========================
apiRouter.get("/users/me", requireAuth, async (req, res) => {
  try {
    const user = await usersCollection.findOne({ discordId: req.session.userId });
    if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json(user);
  } catch (err) {
    console.error("Error en /users/me:", err);
    res.status(500).json({ error: "Error del servidor" });
  }
});

apiRouter.post("/users/update-riot", requireAuthDiscord, async (req, res) => {
  try {
    const { riotId } = req.body;
    const userId = req.session.userId;

    if (!riotId) {
      return res.status(400).json({ error: "Debes enviar un Riot ID" });
    }

    const user = await usersCollection.findOne({ discordId: userId });
    if (!user) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    // Caso 1: Usuario nuevo (nunca ha puesto Riot ID)
    if (!user.riotId) {
      await usersCollection.updateOne(
        { discordId: userId },
        {
          $set: {
            riotId,
            riotIdChanged: false, // indica que todavía puede hacer un cambio
            updatedAt: new Date(),
          },
        }
      );
    }
    // Caso 2: Ya tenía Riot ID pero no ha usado su único cambio
    else if (user.riotId && !user.riotIdChanged) {
      await usersCollection.updateOne(
        { discordId: userId },
        {
          $set: {
            riotId,
            riotIdChanged: true, // ya hizo el único cambio
            updatedAt: new Date(),
          },
        }
      );
    }
    // Caso 3: Ya hizo su único cambio → prohibido
    else {
      return res.status(403).json({ error: "Ya no puedes cambiar tu Riot ID" });
    }

    res.json({ success: true, riotId });
  } catch (err) {
    console.error("Error en /users/update-riot:", err);
    res.status(500).json({ error: "Error del servidor" });
  }
});

// ==========================
// Queue & Matches
// ==========================
const MAPS=["Ascent","Bind","Haven","Icebox","Breeze","split","Fracture","Pearl","Lotus","Sunset","Abyss","Corrode"]; 
const SIDES = ["Attacker", "Defender"];

// Función para unir jugador a la cola global y crear partida automáticamente
async function joinGlobalQueue(userId) {
  // Obtener o crear documento de cola global
  let queueDoc = await customMatchesCollection.findOne({ _id: "globalQueue" });

  if (!queueDoc) {
    await customMatchesCollection.insertOne({ _id: "globalQueue", players: [userId] });
    queueDoc = { _id: "globalQueue", players: [userId] };
  } else {
    if (!queueDoc.players.includes(userId)) {
      await customMatchesCollection.updateOne(
        { _id: "globalQueue" },
        { $addToSet: { players: userId } }
      );
      queueDoc.players.push(userId);
    }
  }

  const queue = queueDoc.players;

  // Crear partida si hay al menos 2 jugadores
  if (queue.length >= 2) {
    const maxPlayers = Math.min(queue.length, 10); // máximo 10 jugadores
    const playersForMatch = queue.slice(0, maxPlayers);

    // Sacar jugadores de la cola
    await customMatchesCollection.updateOne(
      { _id: "globalQueue" },
      { $pull: { players: { $in: playersForMatch } } }
    );

    // Elegir mapa aleatorio
    const map = MAPS[Math.floor(Math.random() * MAPS.length)];

    // Mezclar jugadores y dividir en equipos
    const shuffled = [...playersForMatch].sort(() => 0.5 - Math.random());
    const mid = Math.ceil(shuffled.length / 2);
    const teamAIds = shuffled.slice(0, mid);
    const teamBIds = shuffled.slice(mid);

    // Obtener objetos completos de usuario
    const fetchUsers = async (ids) => {
      const users = await usersCollection.find({ discordId: { $in: ids } }).toArray();
      return ids.map(id => {
        const user = users.find(u => u.discordId === id);
        return {
          id: user.discordId,
          username: user.username,
          avatar: user.avatar,
          riotId: user.riotId || null,
          cardBackground: user.cardBackground || null
        };
      });
    };

    const teamA = await fetchUsers(teamAIds);
    const teamB = await fetchUsers(teamBIds);

    // Elegir líder aleatorio
    const leaderId = playersForMatch[Math.floor(Math.random() * playersForMatch.length)];
    const leaderUser = await usersCollection.findOne({ discordId: leaderId });
    const leader = {
      id: leaderUser.discordId,
      username: leaderUser.username,
      avatar: leaderUser.avatar,
      riotId: leaderUser.riotId || null,
      cardBackground: leaderUser.cardBackground || null
    };

    // Asignar lados
    const sideA = SIDES[Math.floor(Math.random() * SIDES.length)];
    const sideB = sideA === "Attacker" ? "Defender" : "Attacker";

    const newMatch = {
      players: playersForMatch,
      teamA,
      teamB,
      map,
      leader,
      sides: { teamA: sideA, teamB: sideB },
      status: "in_progress",
      createdAt: new Date()
    };

    await customMatchesCollection.insertOne(newMatch);

    return newMatch; // Devuelve partida lista para frontend
  }

  return null; // No hay suficientes jugadores para crear partida
}

// Endpoint para enviar el código de la sala
apiRouter.post("/match/submit-room", requireAuthDiscord, async (req, res) => {
  try {
    const { roomCode } = req.body;
    const userId = req.session.userId;

    if (!roomCode) {
      return res.status(400).json({ error: "Debes enviar un roomCode" });
    }

    // Buscar la partida donde el usuario sea líder
    const match = await customMatchesCollection.findOne({
      status: "in_progress",
      "leader.id": userId   // <-- Cambio importante aquí
    });

    if (!match) {
      return res.status(404).json({ error: "No se encontró partida activa para asignar roomCode" });
    }

    await customMatchesCollection.updateOne(
      { _id: match._id },
      { $set: { roomCode } }
    );

    res.json({ success: true, roomCode });
  } catch (err) {
    console.error("Error en /match/submit-room:", err);
    res.status(500).json({ error: "Error del servidor" });
  }
});

// Endpoint para subir el Tracker
apiRouter.post("/match/submit-tracker", requireAuthDiscord, async (req, res) => {
  try {
    const { trackerUrl } = req.body;
    const userId = req.session.userId;

    if (!trackerUrl) {
      return res.status(400).json({ error: "Debes enviar un trackerUrl" });
    }

    // Buscar la partida donde el usuario sea líder
    const match = await customMatchesCollection.findOne({
      status: "in_progress",
      "leader.id": userId   // líder de la partida
    });

    if (!match) {
      return res.status(404).json({ error: "No se encontró partida activa para asignar trackerUrl" });
    }

    // Validar si ya tiene trackerUrl
    if (match.trackerUrl) {
      return res.status(403).json({ error: "El tracker ya fue enviado y no se puede cambiar" });
    }

    // Actualizar trackerUrl y estado de partida
    await customMatchesCollection.updateOne(
      { _id: match._id },
      {
        $set: {
          trackerUrl,
          status: "finished",
          finishedAt: new Date()
        }
      }
    );

    res.json({ success: true, trackerUrl });
  } catch (err) {
    console.error("Error en /match/submit-tracker:", err);
    res.status(500).json({ error: "Error del servidor" });
  }
});

// Endpoint para unirse a la cola global
apiRouter.post("/queue/join", requireAuthDiscord, async (req, res) => {
  try {
    const userId = req.session.userId;

    // Revisar si ya está en la cola global
    const queueDoc = await customMatchesCollection.findOne({ _id: "globalQueue", players: userId });
    if (queueDoc) return res.status(400).json({ error: "Ya estás en la cola global." });

    const newMatch = await joinGlobalQueue(userId);
    if (newMatch) return res.json({ success: true, match: newMatch, message: "Partida iniciada automáticamente" });

    res.json({ success: true, message: "Jugador agregado a la cola global" });
  } catch (err) {
    console.error("Error en /queue/join:", err);
    res.status(500).json({ error: "Error del servidor" });
  }
});

// Endpoint para salir de la cola global
apiRouter.post("/queue/leave-global", requireAuthDiscord, async (req, res) => {
  try {
    const userId = req.session.userId;
    const result = await customMatchesCollection.updateOne(
      { _id: "globalQueue" },
      { $pull: { players: userId } }
    );
    if (result.modifiedCount === 0) return res.status(404).json({ error: "No estabas en la cola global" });

    res.json({ success: true, message: "Has salido de la cola global" });
  } catch (err) {
    console.error("Error en /queue/leave-global:", err);
    res.status(500).json({ error: "Error del servidor" });
  }
});

// Endpoint para obtener el estado del usuario
apiRouter.get("/queue/my-match", requireAuthDiscord, async (req, res) => {
  try {
    const userId = req.session.userId;

    // Verificar si el usuario ya está en alguna partida in_progress
    const match = await customMatchesCollection.findOne({
      status: "in_progress",
      players: userId
    });

    if (!match) {
      // Revisar si está en la cola global
      const globalQueue = await customMatchesCollection.findOne({ _id: "globalQueue", players: userId });
      return res.json({ inQueueGlobal: !!globalQueue, match: match || null });
    }

    res.json({ match });
  } catch (err) {
    console.error("Error en /queue/my-match:", err);
    res.status(500).json({ error: "Error del servidor" });
  }
});

// ==========================
// Mount API Router
// ==========================
app.use("/api", apiRouter);

// ==========================
// Función de cálculo de score por partida ajustada por rol
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
// Login / Admin
// ==========================
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "1234";

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
    console.error("Error en /login:", err);
    res.status(500).json({ error: "Error del servidor" });
  }
});

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

// ==========================
// CRUD Players
// ==========================
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
    console.error("Error en POST /players:", err);
    res.status(500).json({ error: "Error al añadir jugador" });
  }
});

app.get("/players", requireAdmin, async (req, res) => {
  try {
    const players = await playersCollection.find().toArray();

    const playersWithPercentages = players.map(p => {
      const matches = p.matchesPlayed || 1;
      return {
        ...p,
        hsPercent: p.totalKills ? Math.round((p.totalHeadshotKills / p.totalKills) * 100) : 0,
        KASTPercent: matches ? Math.round(p.totalKAST / matches) : 0
      };
    });

    res.json(playersWithPercentages);
  } catch (err) {
    console.error("Error en GET /players:", err);
    res.status(500).json({ error: "Error al obtener jugadores" });
  }
});

app.put("/players", requireAdmin, async (req, res) => {
  try {
    const { oldName, oldTag, newName, newTag, social, avatarURL } = req.body;
    const result = await playersCollection.updateOne(
      { name: oldName, tag: oldTag },
      { $set: { name: newName, tag: newTag, social, avatarURL } }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: "Jugador no encontrado" });
    }
    
    res.json({ message: "Jugador actualizado" });
  } catch (err) {
    console.error("Error en PUT /players:", err);
    res.status(500).json({ error: "Error actualizando jugador" });
  }
});

app.delete("/players", requireAdmin, async (req, res) => {
  try {
    const { name, tag } = req.body;
    const result = await playersCollection.deleteOne({ name, tag });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Jugador no encontrado" });
    }
    
    res.json({ message: "Jugador eliminado" });
  } catch (err) {
    console.error("Error en DELETE /players:", err);
    res.status(500).json({ error: "Error eliminando jugador" });
  }
});

// ==========================
// CRUD Matches
// ==========================
app.post("/matches", requireAdmin, async (req, res) => {
  try {
    const { match, winnerTeam, score: matchScore, map } = req.body;
    if (!Array.isArray(match) || match.length === 0) return res.status(400).json({ error: "Formato inválido" });

    const newMatch = { match, winnerTeam, score: matchScore, map, date: new Date() };
    await matchesCollection.insertOne(newMatch);

    const teamA = match.slice(0, 5);
    const teamB = match.slice(5, 10);

    for (let i = 0; i < match.length; i++) {
      const p = match[i];
      const playerTeam = i < 5 ? "A" : "B";
      const teamStats = playerTeam === "A" ? teamA : teamB;
      const didWin = playerTeam === winnerTeam;
      
      const { totalScore } = calculateMatchScore(p, playerTeam, teamStats, didWin);
      const currentPlayer = await playersCollection.findOne({ name: p.name, tag: p.tag });
      const newTotalScore = Math.max((currentPlayer?.score || 0) + totalScore, 0);
      const headshotsThisMatch = Math.round((p.hsPercent / 100) * p.kills);

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
            wins: didWin ? 1 : 0
          },
          $set: { score: newTotalScore }
        },
        { upsert: true }
      );
    }

    res.json({ message: "Partida añadida exitosamente" });
  } catch (err) {
    console.error("Error en POST /matches:", err);
    res.status(500).json({ error: "Error al añadir partida" });
  }
});

app.get("/matches", async (req, res) => {
  try {
    const matches = await matchesCollection.find().sort({ date: -1 }).toArray();
    res.json(matches);
  } catch (err) {
    console.error("Error en GET /matches:", err);
    res.status(500).json({ error: "Error obteniendo partidas" });
  }
});

app.put("/matches/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { map, score, winnerTeam } = req.body;
    
    const result = await matchesCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { map, score, winnerTeam } }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: "Partida no encontrada" });
    }
    
    res.json({ message: "Partida actualizada" });
  } catch (err) {
    console.error("Error en PUT /matches/:id:", err);
    res.status(500).json({ error: "Error actualizando partida" });
  }
});

app.delete("/matches/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const matchToDelete = await matchesCollection.findOne({ _id: new ObjectId(id) });
    if (!matchToDelete) return res.status(404).json({ error: "Partida no encontrada" });

    await matchesCollection.deleteOne({ _id: new ObjectId(id) });

    // Resetear stats de todos los jugadores
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

    // Recalcular todas las partidas restantes
    const allMatches = await matchesCollection.find().toArray();
    for (const match of allMatches) {
      const teamA = match.match.slice(0, 5);
      const teamB = match.match.slice(5, 10);

      for (let i = 0; i < match.match.length; i++) {
        const p = match.match[i];
        const playerTeam = i < 5 ? "A" : "B";
        const teamStats = playerTeam === "A" ? teamA : teamB;
        const didWin = playerTeam === match.winnerTeam;
        
        const { totalScore } = calculateMatchScore(p, playerTeam, teamStats, didWin);
        const headshotsThisMatch = Math.round((p.hsPercent / 100) * p.kills);

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
          },
          { upsert: true }
        );
      }
    }

    res.json({ message: "✅ Partida eliminada y estadísticas recalculadas correctamente" });
  } catch (err) {
    console.error("❌ Error en DELETE /matches/:id:", err);
    res.status(500).json({ error: "Error eliminando partida" });
  }
});

// ==========================
// Leaderboard
// ==========================
app.get("/leaderboard", async (req, res) => {
  try {
    const players = await playersCollection.find().toArray();

    const formattedPlayers = players.map(p => {
      const matches = p.matchesPlayed || 1;

      return {
        ...p,
        avgACS: matches ? (p.totalACS / matches) : 0,
        avgFK: matches ? (p.totalFK / matches) : 0,
        avgADR: matches ? (p.totalADR / matches) : 0,
        avgDDDelta: matches ? (p.totalDDDelta / matches) : 0,
        avgKAST: matches ? (p.totalKAST / matches) : 0,
        hsPercent: p.totalKills ? (p.totalHeadshotKills / p.totalKills * 100) : 0
      };
    });

    formattedPlayers.sort((a, b) => (b.score || 0) - (a.score || 0));

    res.json(formattedPlayers);
  } catch (err) {
    console.error("Error en GET /leaderboard:", err);
    res.status(500).json({ error: "Error generando leaderboard" });
  }
});

// ==========================
// Endpoints adicionales
// ==========================
app.get("/matches-count", async (req, res) => {
  try {
    const count = await matchesCollection.countDocuments();
    res.json({ count });
  } catch (err) {
    console.error("Error en GET /matches-count:", err);
    res.status(500).json({ error: "Error al obtener total de partidas" });
  }
});

app.get("/players-count", async (req, res) => {
  try {
    const count = await playersCollection.countDocuments();
    res.json({ count });
  } catch (err) {
    console.error("Error en GET /players-count:", err);
    res.status(500).json({ error: "Error al obtener total de jugadores" });
  }
});

app.get("/last-match", async (req, res) => {
  try {
    const lastMatch = await matchesCollection.find().sort({ date: -1 }).limit(1).toArray();
    res.json(lastMatch[0] || null);
  } catch (err) {
    console.error("Error en GET /last-match:", err);
    res.status(500).json({ error: "Error al obtener última partida" });
  }
});

// ==========================
// Manejo de errores global
// ==========================
app.use((err, req, res, next) => {
  console.error("Error no manejado:", err);
  res.status(500).json({ error: "Error interno del servidor" });
});

app.use((req, res) => {
  res.status(404).json({ error: "Endpoint no encontrado" });
});

// ==========================
// Servidor
// ==========================
connectDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));
}).catch(err => {
  console.error("❌ Error iniciando servidor:", err);
  process.exit(1);
});
