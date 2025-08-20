import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "1234";

// Login page
router.get("/login.html", (req, res) => {
  res.sendFile(path.join(__dirname, "../private/login.html"));
});

// Login
router.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.isAdmin = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ error: "Usuario o contraseña incorrectos" });
  }
});

// Verificar sesión
router.get("/check-session", (req, res) => {
  res.json({ loggedIn: !!req.session.isAdmin });
});

export default router;
