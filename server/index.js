require('dotenv').config();
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey,
  }),
  databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}.firebaseio.com`,
});

const db = admin.firestore();
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

/* ---------- Lectures CRUD ---------- */
app.get('/api/lectures', async (_req, res) => {
  const snap = await db.collection('lectures').get();
  res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
});
app.post('/api/lectures', async (req, res) => {
  const doc = await db.collection('lectures').add(req.body);
  res.status(201).json({ id: doc.id });
});
app.put('/api/lectures/:id', async (req, res) => {
  await db.collection('lectures').doc(req.params.id).set(req.body, { merge: true });
  res.json({ id: req.params.id });
});
app.delete('/api/lectures/:id', async (req, res) => {
  await db.collection('lectures').doc(req.params.id).delete();
  res.sendStatus(204);
});

/* ---------- Students CRUD ---------- */
app.get('/api/students', async (_req, res) => {
  const snap = await db.collection('students').get();
  res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
});
app.post('/api/students', async (req, res) => {
  const doc = await db.collection('students').add(req.body);
  res.status(201).json({ id: doc.id });
});
app.put('/api/students/:id', async (req, res) => {
  await db.collection('students').doc(req.params.id).set(req.body, { merge: true });
  res.json({ id: req.params.id });
});
app.delete('/api/students/:id', async (req, res) => {
  await db.collection('students').doc(req.params.id).delete();
  res.sendStatus(204);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Dashboard running on http://localhost:${PORT}`));

/* GET single lecture */
app.get('/api/lectures/:id', async (req, res) => {
  const doc = await db.collection('lectures').doc(req.params.id).get();
  res.json(doc.data());
});

/* GET single student */
app.get('/api/students/:id', async (req, res) => {
  const doc = await db.collection('students').doc(req.params.id).get();
  res.json(doc.data());
});

/* ---------- Announcements CRUD ---------- */
app.get('/api/announcements', async (_req, res) => {
  const snap = await db.collection('announcements').get();
  res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
});
app.post('/api/announcements', async (req, res) => {
  const doc = await db.collection('announcements').add({ ...req.body, created: new Date() });
  res.status(201).json({ id: doc.id });
});
app.put('/api/announcements/:id', async (req, res) => {
  await db.collection('announcements').doc(req.params.id).set(req.body, { merge: true });
  res.json({ id: req.params.id });
});
app.delete('/api/announcements/:id', async (req, res) => {
  await db.collection('announcements').doc(req.params.id).delete();
  res.sendStatus(204);
});
app.get('/api/announcements/:id', async (req, res) => {
  const doc = await db.collection('announcements').doc(req.params.id).get();
  res.json(doc.data());
});

/* ---------- Banners CRUD ---------- */
app.get('/api/banners', async (_req, res) => {
  const snap = await db.collection('banners').orderBy('order', 'asc').get();
  res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
});
app.post('/api/banners', async (req, res) => {
  const doc = await db.collection('banners').add({ ...req.body, importedAt: new Date(), importedBy: 'dashboard' });
  res.status(201).json({ id: doc.id });
});
app.put('/api/banners/:id', async (req, res) => {
  await db.collection('banners').doc(req.params.id).set(req.body, { merge: true });
  res.json({ id: req.params.id });
});
app.delete('/api/banners/:id', async (req, res) => {
  await db.collection('banners').doc(req.params.id).delete();
  res.sendStatus(204);
});
app.get('/api/banners/:id', async (req, res) => {
  const doc = await db.collection('banners').doc(req.params.id).get();
  res.json(doc.data());
});
