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

// --- CORS ---
const allowedOrigins = [
  "https://valorant-10-mans-frontend.onrender.com",
  "https://valorant-10-mans.onrender.com"
];
app.use(cors({
  origin: (origin, callback) => {
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

app.use(express.json());

// --- Sesiones ---
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

// --- MongoDB ---
if (!process.env.MONGODB_URI) {
  console.error("❌ ERROR: MONGODB_URI no está definido.");
  process.exit(1);
}
let db, playersCollection, eventsCollection;
async function connectDB() {
  try {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    db = client.db("valorantDB");
    playersCollection = db.collection("players");
    eventsCollection = db.collection("events");
    console.log("✅ Conectado a MongoDB");
  } catch (err) {
    console.error("❌ Error conectando a MongoDB:", err);
    process.exit(1);
  }
}

// --- Rutas estáticas ---
app.use(express.static(path.join(__dirname, "../frontend")));
app.use("/private", express.static(path.join(__dirname, "private")));

// --- Login / Admin ---
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "1234";

app.get("/login.html", (req,res)=>res.sendFile(path.join(__dirname,"private/login.html")));
app.post("/login", async (req,res)=>{
  const { username, password } = req.body;
  if(username===ADMIN_USER && password===ADMIN_PASS){
    req.session.isAdmin = true;
    res.json({ success:true });
  }else res.status(401).json({ error:"Usuario o contraseña incorrectos" });
});
function requireAdmin(req,res,next){ if(req.session.isAdmin) next(); else res.status(403).json({error:"Acceso denegado"}); }
app.get("/check-session",(req,res)=>res.json({loggedIn: !!req.session.isAdmin}));
app.get("/admin.html", requireAdmin, (req,res)=>res.sendFile(path.join(__dirname,"private/admin.html")));
app.get("/events.html", requireAdmin, (req,res)=>res.sendFile(path.join(__dirname,"private/events.html")));

// --- CRUD Players ---
app.post("/players", requireAdmin, async (req,res)=>{
  try{
    const { name, tag, badges=[], social={} } = req.body;
    if(!name || !tag) return res.status(400).json({error:"Nombre y tag requeridos"});
    const exists = await playersCollection.findOne({ name, tag });
    if(exists) return res.status(400).json({error:"Jugador ya existe"});
    await playersCollection.insertOne({
      name:name.trim(),
      tag:tag.trim(),
      totalKills:0,
      totalDeaths:0,
      totalAssists:0,
      totalACS:0,
      totalFirstBloods:0,
      totalHeadshotKills:0,
      matchesPlayed:0,
      wins:0,
      badges,
      social
    });
    res.json({ message:"Jugador añadido exitosamente" });
  }catch(err){ console.error(err); res.status(500).json({error:"Error al añadir jugador"}); }
});
app.get("/players", requireAdmin, async (req,res)=>{
  try{ res.json(await playersCollection.find().toArray()); }catch(err){ console.error(err); res.status(500).json({error:"Error al obtener jugadores"}); }
});
app.put("/players", requireAdmin, async (req,res)=>{
  try{
    const { oldName, oldTag, newName, newTag, social } = req.body;
    if(!oldName || !oldTag || !newName || !newTag) return res.status(400).json({ error:"Todos los campos son requeridos" });
    await playersCollection.updateOne({ name:oldName, tag:oldTag }, { $set:{ name:newName, tag:newTag, social:social||{} } });
    res.json({ message:"Jugador actualizado correctamente" });
  }catch(err){ console.error(err); res.status(500).json({error:"Error al actualizar jugador"}); }
});
app.delete("/players", requireAdmin, async (req,res)=>{
  try{
    const { name, tag } = req.body;
    if(!name || !tag) return res.status(400).json({ error:"Nombre y tag requeridos" });
    await playersCollection.deleteOne({ name, tag });
    res.json({ message:"Jugador eliminado correctamente" });
  }catch(err){ console.error(err); res.status(500).json({error:"Error al eliminar jugador"}); }
});

// --- CRUD Events ---
app.post("/events", requireAdmin, async (req,res)=>{
  try{
    const { name, teamSize, numTeams, rounds=0, teams={}, badge } = req.body;
    if(!name || !teamSize || !numTeams) return res.status(400).json({ error:"Completa todos los campos" });
    const exists = await eventsCollection.findOne({ name });
    if(exists) return res.status(400).json({ error:"Evento ya existe" });
    await eventsCollection.insertOne({ name, teamSize, numTeams, rounds, matches:[], teams, badge, createdAt:new Date() });
    res.json({ message:"Evento creado correctamente" });
  }catch(err){ console.error(err); res.status(500).json({ error:"Error al crear evento" }); }
});
app.get("/events", requireAdmin, async (req,res)=>{
  try{ res.json(await eventsCollection.find().sort({ createdAt:-1 }).toArray()); }catch(err){ console.error(err); res.status(500).json({ error:"Error al obtener eventos" }); }
});
app.get("/events/:id", requireAdmin, async (req,res)=>{
  try{
    const { id } = req.params;
    const event = await eventsCollection.findOne({ _id:new ObjectId(id) });
    if(!event) return res.status(404).json({ error:"Evento no encontrado" });
    res.json(event);
  }catch(err){ console.error(err); res.status(500).json({ error:"Error al obtener evento" }); }
});
app.get("/events/:id/matches", requireAdmin, async (req,res)=>{
  try{
    const { id } = req.params;
    const event = await eventsCollection.findOne({ _id:new ObjectId(id) });
    if(!event) return res.status(404).json({ error:"Evento no encontrado" });
    res.json(event.matches||[]);
  }catch(err){ console.error(err); res.status(500).json({ error:"Error al obtener partidas del evento" }); }
});

// --- Registrar match y actualizar stats de jugadores ---
app.post("/events/:id/matches", requireAdmin, async (req,res)=>{
  try{
    const { id } = req.params;
    const { map, winnerTeam, score, teamA, teamB } = req.body;
    if(!map || !winnerTeam || !score) return res.status(400).json({ error:"Completa mapa, ganador y marcador" });

    const event = await eventsCollection.findOne({ _id:new ObjectId(id) });
    if(!event) return res.status(404).json({ error:"Evento no encontrado" });

    // --- Validación de número máximo de partidas ---
    const maxMatches = event.numTeams - 1;
    if((event.matches?.length || 0) >= maxMatches){
      return res.status(400).json({ error:"Ya se registraron todas las partidas necesarias para este torneo" });
    }

    // --- Validar cantidad exacta de jugadores por equipo ---
    if(teamA.length !== event.teamSize || teamB.length !== event.teamSize){
      return res.status(400).json({ error:`Cada equipo debe tener exactamente ${event.teamSize} jugadores` });
    }

    const newMatch = { map, winnerTeam, score, teamA, teamB, date:new Date() };
    await eventsCollection.updateOne({ _id:new ObjectId(id) }, { $push:{ matches:newMatch } });

    // --- Actualizar stats de jugadores ---
    const updatePlayerStats = async (player, teamLabel)=>{
      if(!player || !player.name) return;
      const dbPlayer = await playersCollection.findOne({ name:player.name });
      if(!dbPlayer) return;
      const won = (winnerTeam==='A' && teamLabel==='A') || (winnerTeam==='B' && teamLabel==='B') ? 1 : 0;
      await playersCollection.updateOne({ name:player.name },{
        $inc:{
          totalKills: player.kills || 0,
          totalDeaths: player.deaths || 0,
          totalAssists: player.assists || 0,
          totalACS: player.acs || 0,
          totalFirstBloods: player.firstBloods || 0,
          totalHeadshotKills: player.hsPercent || 0,
          matchesPlayed:1,
          wins: won
        }
      });
    };

    for(const p of teamA) await updatePlayerStats(p, 'A');
    for(const p of teamB) await updatePlayerStats(p, 'B');

    res.json({ message:"Partida añadida y stats actualizadas", match:newMatch });
  }catch(err){ console.error(err); res.status(500).json({ error:"Error al añadir partida" }); }
});

// --- Leaderboard ---
app.get("/leaderboard", async (req,res)=>{
  try{
    const players = await playersCollection.find().toArray();
    const withScores = players.map(p=>{
      const matches = p.matchesPlayed || 0;
      const avgKills = matches?p.totalKills/matches:0;
      const avgDeaths = matches?p.totalDeaths/matches:1;
      const avgACS = matches?p.totalACS/matches:0;
      const avgAssists = matches?p.totalAssists/matches:0;
      const winrate = matches?(p.wins/matches)*100:0;
      const hsPercent = p.totalKills?(p.totalHeadshotKills/p.totalKills)*100:0;
      const avgKDA = avgDeaths===0?avgKills:avgKills/avgDeaths;
      const cappedKills = Math.min(avgKills,30);
      const impactKillsScore = (p.totalFirstBloods*1.5) + (cappedKills-p.totalFirstBloods);
      const scoreRaw = (avgACS*1.5) + (impactKillsScore*1.2) + (avgAssists*0.8) + hsPercent + winrate - avgDeaths;
      const reliabilityFactor = Math.min(matches/5,1);
      const consistencyBonus = 1 + (Math.min(matches,20)/100);
      return {
        name:p.name,
        tag:p.tag,
        avgACS,
        avgKDA,
        hsPercent,
        fk: matches?(p.totalFirstBloods/matches):0,
        winrate,
        score: Math.round(scoreRaw*consistencyBonus*reliabilityFactor),
        matchesPlayed:matches,
        badges:p.badges||[],
        social:p.social||{}
      };
    });
    withScores.sort((a,b)=>b.score-a.score);
    res.json(withScores);
  }catch(err){ console.error(err); res.status(500).json({ error:"Error al generar leaderboard" }); }
});

// --- Logout ---
app.post("/logout",(req,res)=>{
  req.session.destroy(err=>{
    if(err) return res.status(500).json({error:"Error cerrando sesión"});
    res.clearCookie("connect.sid");
    res.json({success:true});
  });
});

// --- Iniciar servidor ---
connectDB().then(()=>app.listen(PORT,()=>console.log(`🚀 Servidor corriendo en puerto ${PORT}`)));
