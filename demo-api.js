// demo-api.js
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const cors    = require('cors');

const app = express();
app.use(cors());

const demoPath = path.join(__dirname, 'public', 'demo');

app.get('/api/lectures',  (_, res) => res.json(require(path.join(demoPath, 'lectures.json'))));
app.get('/api/students',  (_, res) => res.json(require(path.join(demoPath, 'students.json'))));

const PORT = process.env.DEMO_PORT || 4001;
app.listen(PORT, () => console.log(`🎭  Demo API running on :${PORT}`));