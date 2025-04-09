// Estructura general de carpetas:
// - client (React frontend)
// - server (Node.js backend)

// =========================================
// 1. BACKEND (server/index.js)
// =========================================

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { Pool } = require('pg');
const fs = require('fs');
require('dotenv').config();

const app = express();
const upload = multer({ dest: 'uploads/' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(cors());
app.use(express.json());

const authenticateToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.sendStatus(401);
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// Auth Routes
app.post('/api/signup', async (req, res) => {
  const { email, password } = req.body;
  const hashed = await bcrypt.hash(password, 10);
  const result = await pool.query('INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id', [email, hashed]);
  const token = jwt.sign({ id: result.rows[0].id }, process.env.JWT_SECRET);
  res.json({ token });
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  if (!user.rows.length || !(await bcrypt.compare(password, user.rows[0].password))) return res.sendStatus(403);
  const token = jwt.sign({ id: user.rows[0].id }, process.env.JWT_SECRET);
  res.json({ token });
});

// Upload + Transcribe Route
app.post('/api/upload', authenticateToken, upload.single('audio'), async (req, res) => {
  const audioPath = req.file.path;
  const whisperResp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: (() => {
      const formData = new FormData();
      formData.append('file', fs.createReadStream(audioPath));
      formData.append('model', 'whisper-1');
      return formData;
    })()
  });
  const data = await whisperResp.json();
  await pool.query('INSERT INTO transcriptions (user_id, text) VALUES ($1, $2)', [req.user.id, data.text]);
  fs.unlinkSync(audioPath);
  res.json({ text: data.text });
});

app.get('/api/history', authenticateToken, async (req, res) => {
  const result = await pool.query('SELECT * FROM transcriptions WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]);
  res.json(result.rows);
});

app.listen(5000);