const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

// Sub-schema para jugadores en la queue
const queuePlayerSchema = new mongoose.Schema({
  id: { type: String, required: true },
  username: String,
  riotId: String,
  roles: [{ type: String, enum: ["centinela","duelista","iniciador","controlador"] }],
  joinedAt: { type: Date, default: Date.now }
});

const queueSchema = new mongoose.Schema({
  _id: { type: String, default: "globalQueue" },
  players: [queuePlayerSchema]
});

const PublicQueue = mongoose.model("PublicQueue", queueSchema);
const EliteQueue = mongoose.model("EliteQueue", queueSchema);

// 🔹 Métodos
router.get("/:type", async (req, res) => {
  const QueueModel = req.params.type === "elite" ? EliteQueue : PublicQueue;
  const queue = await QueueModel.findById("globalQueue");
  res.json(queue);
});

router.post("/:type/add", async (req, res) => {
  const QueueModel = req.params.type === "elite" ? EliteQueue : PublicQueue;
  const queue = await QueueModel.findById("globalQueue") || new QueueModel();
  queue.players.push(req.body); // req.body debe incluir id, username, riotId, roles
  await queue.save();
  res.json(queue);
});

router.post("/:type/remove", async (req, res) => {
  const QueueModel = req.params.type === "elite" ? EliteQueue : PublicQueue;
  const queue = await QueueModel.findById("globalQueue");
  if (!queue) return res.status(404).json({ message: "Queue not found" });
  queue.players = queue.players.filter(p => p.id !== req.body.id);
  await queue.save();
  res.json(queue);
});

module.exports = router;
