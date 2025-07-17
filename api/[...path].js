// api/[...path].js
// ────────────────────────────────────────────────────────────
//  Universal handler for every `/api/*` request on Vercel.
//  ▸ CommonJS (require) so you don’t need `"type":"module"`
//  ▸ Exports the Express app — DO NOT call app.listen()
// ────────────────────────────────────────────────────────────

const admin  = require('firebase-admin');
const express= require('express');
const cors   = require('cors');
require('dotenv').config();

/*─────────────────────────────────────────────────────────────
  Firebase admin – guard against double-init in dev
──────────────────────────────────────────────────────────────*/
if (!admin.apps.length) {
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '')
                       .replace(/\\n/g, '\n');                 // ← keep line-feeds

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId  : process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey
    })
  });
}
const db = admin.firestore();

/*─────────────────────────────────────────────────────────────
  Express scaffold
──────────────────────────────────────────────────────────────*/
const app = express();
app.use(cors());
app.use(express.json());

/*=============================================================
  STUDENTS  — cursor-pagination + cheap count
=============================================================*/
app.get('/students', async (req, res) => {
  try {
    const limit        = parseInt(req.query.limit || '30', 10);
    const startAfterId = req.query.startAfterId || null;

    let q = db.collection('students')
              .orderBy('createdAt', 'desc')
              .orderBy('name');

    if (startAfterId) {
      const snap = await db.collection('students').doc(startAfterId).get();
      if (!snap.exists) return res.status(404).json({ error: 'startAfterId not found' });
      q = q.startAfter(snap);
    }

    const snap  = await q.limit(limit).get();
    const rows  = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const last  = snap.size ? snap.docs[snap.size - 1].id : null;

    const payload = {
      students   : rows,
      lastVisible: last,
      hasMore    : snap.size === limit
    };

    if (!startAfterId) {
      const cnt = await db.collection('students').count().get();
      payload.totalStudents = cnt.data().count;
    }
    res.json(payload);

  } catch (e) {
    console.error(e);
    res.status(500).json({ error:'Failed to fetch students', details:e.message });
  }
});

app.post('/students', async (req, res) => {
  const d = await db.collection('students').add({
    ...req.body,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  res.status(201).json({ id:d.id });
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

/*=============================================================
  LECTURES  — newest-first, filter-aware, cursor-pagination
=============================================================*/
app.get('/lectures', async (req, res) => {
  try {
    const limit        = parseInt(req.query.limit || '30', 10);
    const startAfterId = req.query.startAfterId || null;

    const { dateFilter, course, faculty, mode } = req.query;

    let orderField = 'createdAt', orderDir = 'desc';
    const today = new Date(); today.setHours(0,0,0,0);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate()+1);

    const col = db.collection('lectures');

    const hasIneq = dateFilter === 'previous' || dateFilter === 'upcoming';
    if (hasIneq) { orderField = 'date'; orderDir = 'asc'; }

    let q = col.orderBy(orderField, orderDir);

    if (course  && course  !== 'all') q = q.where('course',  '==', course);
    if (faculty && faculty !== 'all') q = q.where('faculty', '==', faculty);
    if (mode    && mode    !== 'all')
      q = q.where('mode', '==', mode.charAt(0).toUpperCase()+mode.slice(1));

    if (dateFilter === 'today')
      q = q.where('date','==',today.toISOString().split('T')[0]);
    else if (dateFilter === 'previous')
      q = q.where('date','<', today.toISOString().split('T')[0]);
    else if (dateFilter === 'upcoming')
      q = q.where('date','>=',tomorrow.toISOString().split('T')[0]);

    if (startAfterId) {
      const snap = await col.doc(startAfterId).get();
      if (!snap.exists) return res.status(404).json({ error:'startAfterId not found' });
      q = q.startAfter(snap);
    }

    const snap  = await q.limit(limit).get();
    const rows  = snap.docs.map(d=>({id:d.id,...d.data()}));
    const last  = snap.size ? snap.docs[snap.size-1].id : null;

    res.json({ lectures:rows, lastVisible:last, hasMore:snap.size===limit });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error:'Failed to fetch lectures', details:e.message });
  }
});

app.post('/lectures', async (req,res)=>{
  const d = await db.collection('lectures').add({
    ...req.body,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  res.status(201).json({id:d.id});
});

app.put('/lectures/:id', async (req,res)=>{
  await db.collection('lectures').doc(req.params.id).set(req.body,{merge:true});
  res.json({id:req.params.id});
});

app.delete('/lectures/:id',async (req,res)=>{
  await db.collection('lectures').doc(req.params.id).delete();
  res.sendStatus(204);
});

app.get('/lectures/:id', async (req,res)=>{
  const d = await db.collection('lectures').doc(req.params.id).get();
  if(!d.exists) return res.status(404).json({error:'Lecture not found'});
  res.json(d.data());
});

/*=============================================================
  (Optional) keep UI happy — minimal announcements / banners
=============================================================*/
app.get('/announcements', async (_req,res)=>{
  const s=await db.collection('announcements').get();
  res.json(s.docs.map(d=>({id:d.id,...d.data()})));
});
app.get('/banners', async (_req,res)=>{
  const s=await db.collection('banners').orderBy('order','asc').get();
  res.json(s.docs.map(d=>({id:d.id,...d.data()})));
});

/* health-check for quick ping */
app.get('/ping', (_req,res)=>res.send('pong'));

/*─────────────────────────────────────────────────────────────
  EXPORT – required by Vercel.  NO app.listen() !
──────────────────────────────────────────────────────────────*/
module.exports = app;     // = default export for the Serverless Function
