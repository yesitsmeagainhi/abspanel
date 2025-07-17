// api/index.js
// ───────────────────────────────────────────────────────────
//  Vercel Serverless Function – **export the Express app**, 
//  never call app.listen()
// ───────────────────────────────────────────────────────────
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const admin   = require('firebase-admin');

/* ───────────────────────────────────────────────────────────
   Firebase initialisation  – protect against double-init
   ─────────────────────────────────────────────────────────── */
if (!admin.apps.length) {
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId  : process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey
    }),
    databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}.firebaseio.com`
  });
}
const db = admin.firestore();

/* ───────────────────────────────────────────────────────────
   Express app scaffold
   ─────────────────────────────────────────────────────────── */
const app = express();
app.use(cors());
app.use(express.json());  // body-parser

/**************************************************************************
 *  STUDENTS  – cursor-based pagination + cheap total count
 **************************************************************************/
app.get('/students', async (req, res) => {
  try {
    const limit        = parseInt(req.query.limit || '30', 10);
    const startAfterId = req.query.startAfterId || null;

    let q = db.collection('students')
              .orderBy('createdAt', 'desc')
              .orderBy('name');               // secondary key

    if (startAfterId) {
      const snap = await db.collection('students').doc(startAfterId).get();
      if (!snap.exists) return res.status(404).json({ error: 'startAfterId not found' });
      q = q.startAfter(snap);
    }

    const snap  = await q.limit(limit).get();
    const rows  = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const lastId= snap.size ? snap.docs[snap.size - 1].id : null;

    const payload = {
      students   : rows,
      lastVisible: lastId,
      hasMore    : snap.size === limit
    };

    /* one expensive count only on first page */
    if (!startAfterId) {
      if (typeof db.collection('students').count === 'function') {
        const cnt = await db.collection('students').count().get();
        payload.totalStudents = cnt.data().count;
      } else {
        payload.totalStudents = (await db.collection('students').select().get()).size;
      }
    }

    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch students', details: err.message });
  }
});

app.post('/students', async (req, res) => {
  const doc = await db.collection('students').add({
    ...req.body,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  res.status(201).json({ id: doc.id });
});

app.put('/students/:id',  async (req,res)=>{
  await db.collection('students').doc(req.params.id).set(req.body,{merge:true});
  res.json({id:req.params.id});
});

app.delete('/students/:id',async (req,res)=>{
  await db.collection('students').doc(req.params.id).delete();
  res.sendStatus(204);
});

app.get('/students/:id', async (req,res)=>{
  const d = await db.collection('students').doc(req.params.id).get();
  if(!d.exists) return res.status(404).json({error:'Student not found'});
  res.json(d.data());
});


/**************************************************************************
 *  LECTURES  – newest-first, filter-aware, cursor pagination
 **************************************************************************/
app.get('/lectures', async (req, res) => {
  try {
    const limit        = parseInt(req.query.limit || '30', 10);
    const startAfterId = req.query.startAfterId || null;

    const dateFilter   = req.query.dateFilter;   // today | previous | upcoming
    const courseFilter = req.query.course;
    const facultyFilter= req.query.faculty;
    const modeFilter   = req.query.mode;         // Online | Offline

    /* build query */
    let orderField = 'createdAt';
    let orderDir   = 'desc';

    const today    = new Date(); today.setHours(0,0,0,0);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);

    const col = db.collection('lectures');

    const hasIneq = dateFilter === 'previous' || dateFilter === 'upcoming';
    if (hasIneq) { orderField = 'date'; orderDir = 'asc'; }

    let q = col.orderBy(orderField, orderDir);

    if (courseFilter  && courseFilter  !== 'all') q = q.where('course',  '==', courseFilter);
    if (facultyFilter && facultyFilter !== 'all') q = q.where('faculty', '==', facultyFilter);
    if (modeFilter    && modeFilter    !== 'all')
      q = q.where('mode', '==', modeFilter.charAt(0).toUpperCase() + modeFilter.slice(1));

    if (dateFilter === 'today')
      q = q.where('date', '==', today.toISOString().split('T')[0]);
    else if (dateFilter === 'previous')
      q = q.where('date', '<',  today.toISOString().split('T')[0]);
    else if (dateFilter === 'upcoming')
      q = q.where('date', '>=', tomorrow.toISOString().split('T')[0]);

    if (startAfterId) {
      const snap = await col.doc(startAfterId).get();
      if (!snap.exists) return res.status(404).json({ error: 'startAfterId not found' });
      q = q.startAfter(snap);
    }

    const snap  = await q.limit(limit).get();
    const rows  = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const lastId= snap.size ? snap.docs[snap.size - 1].id : null;

    res.json({ lectures: rows, lastVisible: lastId, hasMore: snap.size === limit });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch lectures', details: err.message });
  }
});

app.post('/lectures', async (req, res) => {
  const doc = await db.collection('lectures').add({
    ...req.body,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  res.status(201).json({ id: doc.id });
});

app.put('/lectures/:id', async (req,res)=>{
  await db.collection('lectures').doc(req.params.id).set(req.body,{merge:true});
  res.json({id:req.params.id});
});
app.delete('/lectures/:id', async (req,res)=>{
  await db.collection('lectures').doc(req.params.id).delete();
  res.sendStatus(204);
});
app.get('/lectures/:id', async (req,res)=>{
  const d = await db.collection('lectures').doc(req.params.id).get();
  if(!d.exists) return res.status(404).json({error:'Lecture not found'});
  res.json(d.data());
});


/**************************************************************************
 *  ANNOUNCEMENTS & BANNERS  (optional – keep ui happy)
 **************************************************************************/
app.get('/announcements', async (_req,res)=>{
  const s = await db.collection('announcements').get();
  res.json(s.docs.map(d=>({id:d.id,...d.data()})));
});
app.post('/announcements',async (req,res)=>{
  const doc = await db.collection('announcements').add({...req.body, created: new Date()});
  res.status(201).json({id:doc.id});
});
app.put('/announcements/:id',async (req,res)=>{
  await db.collection('announcements').doc(req.params.id).set(req.body,{merge:true});
  res.json({id:req.params.id});
});
app.delete('/announcements/:id',async (req,res)=>{
  await db.collection('announcements').doc(req.params.id).delete();
  res.sendStatus(204);
});

app.get('/banners', async (_req,res)=>{
  const s = await db.collection('banners').orderBy('order','asc').get();
  res.json(s.docs.map(d=>({id:d.id,...d.data()})));
});
app.post('/banners',async (req,res)=>{
  const doc = await db.collection('banners').add({...req.body, importedAt:new Date(), importedBy:'dashboard'});
  res.status(201).json({id:doc.id});
});
app.put('/banners/:id',async (req,res)=>{
  await db.collection('banners').doc(req.params.id).set(req.body,{merge:true});
  res.json({id:req.params.id});
});
app.delete('/banners/:id',async (req,res)=>{
  await db.collection('banners').doc(req.params.id).delete();
  res.sendStatus(204);
});


/**************************************************************************
 *  EXPORT for Vercel  – do NOT call app.listen()
 **************************************************************************/
module.exports = app;
