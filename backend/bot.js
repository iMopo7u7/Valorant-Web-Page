import { Client, GatewayIntentBits, Partials, ChannelType } from "discord.js";
import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Channel]
});

const mongoClient = new MongoClient(process.env.MONGO_URI);
let db, matchesCollection;

const GUILD_ID = process.env.DISCORD_GUILD_ID;

client.once("ready", async () => {
  console.log(`Bot listo! Logged in as ${client.user.tag}`);
  
  await mongoClient.connect();
  db = mongoClient.db(process.env.MONGO_DB_NAME);
  matchesCollection = db.collection("customMatches");

  // Escuchar cambios en la colección
  const changeStream = matchesCollection.watch();
  changeStream.on("change", async (change) => {
    try {
      if (change.operationType === "update") {
        const matchId = change.documentKey._id;
        const updatedFields = change.updateDescription.updatedFields;

        // Cuando el líder agrega el código de sala
        if (updatedFields.roomCode) {
          const match = await matchesCollection.findOne({ _id: new ObjectId(matchId) });
          if (!match) return;

          await createDiscordChannels(match);
        }

        // Cuando la partida se completa
        if (updatedFields.status === "completed") {
          const match = await matchesCollection.findOne({ _id: new ObjectId(matchId) });
          if (!match || !match.discordChannels) return;

          await deleteDiscordChannels(match.discordChannels);
        }
      }
    } catch (err) {
      console.error("Error manejando cambios de Mongo:", err);
    }
  });
});

// ------------------------
// --- Funciones de Discord
// ------------------------
async function createDiscordChannels(match) {
  const guild = await client.guilds.fetch(GUILD_ID);

  // Crear canal de texto para todos
  const textChannel = await guild.channels.create({
    name: `match-${match._id.toString().slice(-4)}`,
    type: ChannelType.GuildText,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: ['ViewChannel'] },
      ...[...match.teamA, ...match.teamB].map(id => ({
        id,
        allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory']
      }))
    ]
  });

  // Canales de voz
  const voiceA = await guild.channels.create({
    name: `Team-A-${match._id.toString().slice(-4)}`,
    type: ChannelType.GuildVoice,
    permissionOverwrites: match.teamA.map(id => ({
      id,
      allow: ['Connect', 'Speak']
    }))
  });

  const voiceB = await guild.channels.create({
    name: `Team-B-${match._id.toString().slice(-4)}`,
    type: ChannelType.GuildVoice,
    permissionOverwrites: match.teamB.map(id => ({
      id,
      allow: ['Connect', 'Speak']
    }))
  });

  // Guardar referencias en DB para luego borrarlos
  await matchesCollection.updateOne(
    { _id: match._id },
    { $set: { discordChannels: { textChannelId: textChannel.id, voiceAId: voiceA.id, voiceBId: voiceB.id } } }
  );

  // Enviar mensaje con info de la partida
  const message = `
**Partida iniciada**
Mapa: ${match.map}
Líder: <@${match.leaderId}>
Room Code: ${match.roomCode}

**Team A**
${match.teamA.map(id => `<@${id}>`).join("\n")}

**Team B**
${match.teamB.map(id => `<@${id}>`).join("\n")}
  `;
  await textChannel.send(message);
}

async function deleteDiscordChannels(channels) {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    if (channels.textChannelId) await guild.channels.fetch(channels.textChannelId).then(c => c.delete().catch(() => {}));
    if (channels.voiceAId) await guild.channels.fetch(channels.voiceAId).then(c => c.delete().catch(() => {}));
    if (channels.voiceBId) await guild.channels.fetch(channels.voiceBId).then(c => c.delete().catch(() => {}));
  } catch (err) {
    console.error("Error borrando canales:", err);
  }
}

client.login(process.env.DISCORD_TOKEN);
