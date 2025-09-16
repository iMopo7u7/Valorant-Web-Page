const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

// Schema
const userSchema = new mongoose.Schema({
  discordId: { type: String, required: true, unique: true },
  username: String,
  avatarURL: String,
  discordSession: {
    accessToken: String,
    refreshToken: String,
    expiresAt: Date
  },
  riotId: { type: String, required: true },
  name: String,
  tag: String,
  isAuthorized: { type: Boolean, default: false },
  isAdmin: { type: Boolean, default: false },
  roles: {
    type: [String],
    enum: ["centinela", "duelista", "iniciador", "controlador"],
    validate: v => v.length <= 3
  },
  stats: {
    public: {
      matchesPlayed: { type: Number, default: 0 },
      wins: { type: Number, default: 0 },
      totalKills: { type: Number, default: 0 },
      totalDeaths: { type: Number, default: 0 },
      totalAssists: { type: Number, default: 0 },
      totalACS: { type: Number, default: 0 },
      totalDDDelta: { type: Number, default: 0 },
      totalADR: { type: Number, default: 0 },
      totalHeadshotKills: { type: Number, default: 0 },
      totalKAST: { type: Number, default: 0 },
      totalFK: { type: Number, default: 0 },
      totalFD: { type: Number, default: 0 },
      totalMK: { type: Number, default: 0 },
      score: { type: Number, default: 0 }
    },
    elite: {
      matchesPlayed: { type: Number, default: 0 },
      wins: { type: Number, default: 0 },
      totalKills: { type: Number, default: 0 },
      totalDeaths: { type: Number, default: 0 },
      totalAssists: { type: Number, default: 0 },
      totalACS: { type: Number, default: 0 },
      totalDDDelta: { type: Number, default: 0 },
      totalADR: { type: Number, default: 0 },
      totalHeadshotKills: { type: Number, default: 0 },
      totalKAST: { type: Number, default: 0 },
      totalFK: { type: Number, default: 0 },
      totalFD: { type: Number, default: 0 },
      totalMK: { type: Number, default: 0 },
      score: { type: Number, default: 0 }
    }
  },
  social: {
    tracker: String,
    twitter: String,
    twitch: String
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const User = mongoose.model("User", userSchema);

// 🔹 Métodos
router.get("/", async (req, res) => {
  const users = await User.find();
  res.json(users);
});

router.get("/:id", async (req, res) => {
  const user = await User.findById(req.params.id);
  res.json(user);
});

router.post("/", async (req, res) => {
  const newUser = new User(req.body);
  await newUser.save();
  res.json(newUser);
});

router.put("/:id", async (req, res) => {
  const updatedUser = await User.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json(updatedUser);
});

router.delete("/:id", async (req, res) => {
  await User.findByIdAndDelete(req.params.id);
  res.json({ message: "User deleted" });
});

module.exports = router;
