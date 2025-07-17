// server/index.js
// ───────────────────────────────────────────────────────────
//  Single source of truth for the API.
//    • export the Express app (for serverless / tests / Vercel)
//    • start app.listen() only when run directly (local / Render)
// ───────────────────────────────────────────────────────────
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const admin   = require('firebase-admin');

/*────────────── Firebase Admin (guard against double-init) */
if (!admin.apps.length) {
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '')
    .replace(/\\n/g, '\n');                       // keep real line-feeds!

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId  : process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey
    })
  });
}
const db = admin.firestore();

/*────────────── Build Express app */
const app = express();
/* ─────── Password lock (add just below const app = express(); ) ─────── */
const basicAuth = require('express-basic-auth');
app.use(basicAuth({
  users: { admin: process.env.SITE_PASSWORD }, // 1 shared user / pass
  challenge: true                              // browser pop-up
}));
app.use(cors());
app.use(express.json());
app.use(express.static('public'));      // serves your HTML/CSS/JS

/*===========================================================*/
/*  ROUTER (mounted twice – see bottom)                      */
/*===========================================================*/
const r = express.Router();

/*---------- STUDENTS --------------------------------------*/
r.get('/students', async (req, res) => {
  try {
    const limit   = parseInt(req.query.limit || '30', 10);
    const afterId = req.query.startAfterId || null;

    let q = db.collection('students')
              .orderBy('createdAt', 'desc')
              .orderBy('name');

    if (afterId) {
      const snap = await db.collection('students').doc(afterId).get();
      if (!snap.exists) return res.status(404).json({ error:'startAfterId not found' });
      q = q.startAfter(snap);
    }

    const snap   = await q.limit(limit).get();
    const rows   = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    const lastId = snap.size ? snap.docs[snap.size-1].id : null;

    const payload = {
      students   : rows,
      lastVisible: lastId,
      hasMore    : snap.size === limit
    };

    if (!afterId) {
      const cnt = await db.collection('students').count().get();
      payload.totalStudents = cnt.data().count;
    }
    res.json(payload);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error:'Failed to fetch students', details:e.message });
  }
});

r.post('/students', async (req,res)=>{
  const d = await db.collection('students').add({
    ...req.body,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  res.status(201).json({id:d.id});
});

r.put('/students/:id',  async (req,res)=>{
  await db.collection('students').doc(req.params.id).set(req.body,{merge:true});
  res.json({id:req.params.id});
});

r.delete('/students/:id',async (req,res)=>{
  await db.collection('students').doc(req.params.id).delete();
  res.sendStatus(204);
});

r.get('/students/:id', async (req,res)=>{
  const d = await db.collection('students').doc(req.params.id).get();
  if(!d.exists) return res.status(404).json({error:'Student not found'});
  res.json(d.data());
});

/*---------- LECTURES --------------------------------------*/
r.get('/lectures', async (req,res)=>{
  try{
    const limit   = parseInt(req.query.limit||'30',10);
    const afterId = req.query.startAfterId || null;
    const { dateFilter, course, faculty, mode } = req.query;

    /* order field logic */
    let orderField='createdAt', orderDir='desc';
    const today=new Date(); today.setHours(0,0,0,0);
    const tomorrow=new Date(today); tomorrow.setDate(today.getDate()+1);

    const col = db.collection('lectures');
    const ineq = dateFilter==='previous'||dateFilter==='upcoming';
    if (ineq){ orderField='date'; orderDir='asc'; }

    let q = col.orderBy(orderField,orderDir);

    if (course  && course!=='all')  q=q.where('course','==',course);
    if (faculty && faculty!=='all') q=q.where('faculty','==',faculty);
    if (mode    && mode!=='all')
      q=q.where('mode','==',mode.charAt(0).toUpperCase()+mode.slice(1));

    if (dateFilter==='today')
      q=q.where('date','==',today.toISOString().split('T')[0]);
    else if (dateFilter==='previous')
      q=q.where('date','<', today.toISOString().split('T')[0]);
    else if (dateFilter==='upcoming')
      q=q.where('date','>=',tomorrow.toISOString().split('T')[0]);

    if (afterId){
      const s=await col.doc(afterId).get();
      if(!s.exists) return res.status(404).json({error:'startAfterId not found'});
      q=q.startAfter(s);
    }

    const snap = await q.limit(limit).get();
    const rows = snap.docs.map(d=>({id:d.id,...d.data()}));
    const last = snap.size ? snap.docs[snap.size-1].id : null;

    res.json({lectures:rows,lastVisible:last,hasMore:snap.size===limit});
  }catch(e){
    console.error(e);
    res.status(500).json({error:'Failed to fetch lectures',details:e.message});
  }
});

r.post('/lectures', async (req,res)=>{
  const d=await db.collection('lectures').add({
    ...req.body,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  res.status(201).json({id:d.id});
});

r.put('/lectures/:id', async (req,res)=>{
  await db.collection('lectures').doc(req.params.id).set(req.body,{merge:true});
  res.json({id:req.params.id});
});
r.delete('/lectures/:id',async (req,res)=>{
  await db.collection('lectures').doc(req.params.id).delete();
  res.sendStatus(204);
});
r.get('/lectures/:id', async (req,res)=>{
  const d=await db.collection('lectures').doc(req.params.id).get();
  if(!d.exists) return res.status(404).json({error:'Lecture not found'});
  res.json(d.data());
});

/*---------- Misc ------------------------------------------*/
r.get('/ping',(_req,res)=>res.send('pong'));

/*===========================================================*/
/*  Mount router twice                                       */
/*===========================================================*/
app.use('/api', r);   // local / Render  (your front-end calls /api/…)
app.use('/',    r);   // Vercel rewrites /api/foo → /foo internally

/*──────── EXPORT (for Vercel & tests) ───────────────────────*/
module.exports = app;

/*──────── Local / Render bootstrap ─────────────────────────*/
if (require.main === module) {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () =>
    console.log(`✅  API ready  →  http://localhost:${PORT}/api/ping`)
  );
}
