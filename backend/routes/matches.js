const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

// Schema
const matchSchema = new mongoose.Schema({
  roomCode: String,
  season: Number,
  matchType: { type: String, enum: ["public", "elite"], required: true },
  status: { type: String, enum: ["pending", "active", "finished"], default: "pending" },
  statsStatus: { type: String, enum: ["pending", "completed"], default: "pending" },
  map: String,
  startingSides: {
    teamA: { type: String, enum: ["Attacker", "Defender"] },
    teamB: { type: String, enum: ["Attacker", "Defender"] }
  },
  createdAt: { type: Date, default: Date.now },
  finishedAt: Date,
  trackerUrl: String,
  leader: {
    id: String,
    username: String,
    avatar: String,
    riotId: String
  },
  teamA: [{
    id: String,
    username: String,
    avatar: String,
    riotId: String,
    character: String,
    ACS: Number,
    kills: Number,
    deaths: Number,
    assists: Number,
    hsPercent: Number,
    FK: Number,
    FD: Number,
    MK: Number,
    KAST: Number,
    ADR: Number,
    DDDelta: Number,
    score: Number
  }],
  teamB: [{
    id: String,
    username: String,
    avatar: String,
    riotId: String,
    character: String,
    ACS: Number,
    kills: Number,
    deaths: Number,
    assists: Number,
    hsPercent: Number,
    FK: Number,
    FD: Number,
    MK: Number,
    KAST: Number,
    ADR: Number,
    DDDelta: Number,
    score: Number
  }],
  winnerTeam: { type: String, enum: ["A", "B"] },
  score: String
});

const Match = mongoose.model("Match", matchSchema);

// 🔹 Métodos
router.get("/", async (req, res) => {
  const matches = await Match.find();
  res.json(matches);
});

router.get("/:id", async (req, res) => {
  const match = await Match.findById(req.params.id);
  res.json(match);
});

router.post("/", async (req, res) => {
  const newMatch = new Match(req.body);
  await newMatch.save();
  res.json(newMatch);
});

router.put("/:id", async (req, res) => {
  const updatedMatch = await Match.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json(updatedMatch);
});

router.delete("/:id", async (req, res) => {
  await Match.findByIdAndDelete(req.params.id);
  res.json({ message: "Match deleted" });
});

module.exports = router;
