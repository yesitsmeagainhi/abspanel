/************************************************************
 *  ABS Dashboard — Express + Firestore
 *  Cost-optimised (1 read per page) + newest-first ordering *
 ************************************************************/

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const admin   = require('firebase-admin');

/* ---------- Firebase initialisation ---------- */
const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

admin.initializeApp({
  credential: admin.credential.cert({
    projectId  : process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey
  }),
  databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}.firebaseio.com`
});

const db = admin.firestore();

/* ---------- Express bootstrap ---------- */
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

/* ==========================================================
   STUDENTS  — cursor pagination + cheap count
   ==========================================================*/

app.get('/api/students', async (req, res) => {
  try {
    const limit        = parseInt(req.query.limit || '30', 10);
    const startAfterId = req.query.startAfterId || null;

    let q = db.collection('students')
              .orderBy('createdAt', 'desc')   // newest first
              .orderBy('name');               // fallback while old docs still missing createdAt

    if (startAfterId) {
      const snap = await db.collection('students').doc(startAfterId).get();
      if (!snap.exists) return res.status(404).json({ error: 'startAfterId not found' });
      q = q.startAfter(snap);
    }

    const pageSnap = await q.limit(limit).get();
    const students = pageSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const lastId   = pageSnap.size ? pageSnap.docs[pageSnap.size - 1].id : null;

    const payload  = {
      students,
      lastVisible: lastId,
      hasMore   : pageSnap.size === limit
    };

    /* get total count once on first page (save 50 % reads) */
    if (!startAfterId) {
      if (typeof db.collection('students').count === 'function') {
        const c = await db.collection('students').count().get();
        payload.totalStudents = c.data().count;
      } else {
        /* old SDK fallback */
        payload.totalStudents = (await db.collection('students').select().get()).size;
      }
    }

    res.json(payload);

  } catch (err) {
    console.error('Error fetching students:', err);
    res.status(500).json({ error: 'Failed to fetch students', details: err.message });
  }
});

app.post('/api/students', async (req, res) => {
  const doc = await db.collection('students').add({
    ...req.body,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  res.status(201).json({ id: doc.id });
});
app.put('/api/students/:id',  async (req,res)=>{ await db.collection('students').doc(req.params.id).set(req.body,{merge:true}); res.json({id:req.params.id}); });
app.delete('/api/students/:id',async (req,res)=>{ await db.collection('students').doc(req.params.id).delete(); res.sendStatus(204); });
app.get('/api/students/:id', async (req,res)=>{ const d=await db.collection('students').doc(req.params.id).get(); res.json(d.data()); });

/* ==========================================================
   LECTURES  — newest first, filter-aware, cursor pagination
   ==========================================================*/

app.get('/api/lectures', async (req, res) => {
  try {
    const limit        = parseInt(req.query.limit || '30', 10);
    const startAfterId = req.query.startAfterId || null;

    /* filters */
    const dateFilter   = req.query.dateFilter;   // today | previous | upcoming
    const courseFilter = req.query.course;
    const facultyFilter= req.query.faculty;
    const modeFilter   = req.query.mode;         // Online | Offline

    /* ------------ build query ------------ */
    let orderField = 'createdAt';
    let orderDir   = 'desc';

    const today    = new Date(); today.setHours(0,0,0,0);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);

    const col = db.collection('lectures');

    /* if we use < or >= on date, Firestore requires we order by that same field */
    const hasInequality = dateFilter === 'previous' || dateFilter === 'upcoming';
    if (hasInequality) {
      orderField = 'date';
      orderDir   = 'asc';
    }

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

    const pageSnap = await q.limit(limit).get();
    const lectures = pageSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const lastId   = pageSnap.size ? pageSnap.docs[pageSnap.size - 1].id : null;

    res.json({
      lectures,
      lastVisible: lastId,
      hasMore    : pageSnap.size === limit
    });

  } catch (err) {
    console.error('Error fetching lectures:', err);
    res.status(500).json({ error: 'Failed to fetch lectures', details: err.message });
  }
});

app.post('/api/lectures', async (req, res) => {
  const doc = await db.collection('lectures').add({
    ...req.body,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  res.status(201).json({ id: doc.id });
});
app.put('/api/lectures/:id',  async (req,res)=>{ await db.collection('lectures').doc(req.params.id).set(req.body,{merge:true}); res.json({id:req.params.id}); });
app.delete('/api/lectures/:id',async (req,res)=>{ await db.collection('lectures').doc(req.params.id).delete(); res.sendStatus(204); });
app.get('/api/lectures/:id',  async (req,res)=>{ const d=await db.collection('lectures').doc(req.params.id).get(); if(!d.exists) return res.status(404).json({error:'Lecture not found'}); res.json(d.data()); });

/* ==========================================================
   ANNOUNCEMENTS  &  BANNERS   (unchanged)
   ==========================================================*/

app.get('/api/announcements', async (_req,res)=>{
  const snap = await db.collection('announcements').get();
  res.json(snap.docs.map(d=>({id:d.id,...d.data()})));
});
app.post('/api/announcements',async (req,res)=>{
  const doc = await db.collection('announcements').add({ ...req.body, created: new Date() });
  res.status(201).json({ id: doc.id });
});
app.put('/api/announcements/:id', async (req,res)=>{ await db.collection('announcements').doc(req.params.id).set(req.body,{merge:true}); res.json({id:req.params.id}); });
app.delete('/api/announcements/:id', async (req,res)=>{ await db.collection('announcements').doc(req.params.id).delete(); res.sendStatus(204); });
app.get('/api/announcements/:id', async (req,res)=>{ const d=await db.collection('announcements').doc(req.params.id).get(); res.json(d.data()); });

app.get('/api/banners', async (_req,res)=>{
  const snap = await db.collection('banners').orderBy('order','asc').get();
  res.json(snap.docs.map(d=>({id:d.id,...d.data()})));
});
app.post('/api/banners', async (req,res)=>{
  const doc = await db.collection('banners').add({ ...req.body, importedAt: new Date(), importedBy: 'dashboard' });
  res.status(201).json({ id: doc.id });
});
app.put('/api/banners/:id',async (req,res)=>{ await db.collection('banners').doc(req.params.id).set(req.body,{merge:true}); res.json({id:req.params.id}); });
app.delete('/api/banners/:id',async (req,res)=>{ await db.collection('banners').doc(req.params.id).delete(); res.sendStatus(204); });
app.get('/api/banners/:id', async (req,res)=>{ const d=await db.collection('banners').doc(req.params.id).get(); res.json(d.data()); });

/* ---------- START SERVER ---------- */
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Dashboard API @ http://localhost:${PORT}`));
