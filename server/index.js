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

// Replace your existing r.get('/lectures', ...) route with this:

r.get('/lectures', async (req,res)=>{
  try{
    console.log('=== LECTURES API DEBUG ===');
    console.log('Query params:', req.query);
    
    const limit   = parseInt(req.query.limit||'30',10);
    const page    = parseInt(req.query.page||'1',10);
    const { dateFilter, course, faculty, mode, branch, startDate, endDate } = req.query;

    console.log('Parsed filters:', { dateFilter, course, faculty, mode, branch, startDate, endDate });

    // FIX: Proper date handling for Indian timezone
    const now = new Date();
    const today = new Date(now.getTime() + (5.5 * 60 * 60 * 1000)); // IST offset
    today.setUTCHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];
    
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(today.getUTCDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    console.log('Server dates:', { todayStr, tomorrowStr, serverTime: now.toISOString() });

    const col = db.collection('lectures');
    
    // Build query with filters but NO pagination yet
    let q = col;

    // Apply filters with debug logging
    let filterCount = 0;
    
    if (course && course !== 'all') {
      console.log('Applying course filter:', course);
      q = q.where('course', '==', course);
      filterCount++;
    }
    
    if (faculty && faculty !== 'all') {
      console.log('Applying faculty filter:', faculty);
      q = q.where('faculty', '==', faculty);
      filterCount++;
    }
    
    if (branch && branch !== 'all') {
      console.log('Applying branch filter:', branch);
      q = q.where('branch', '==', branch);
      filterCount++;
    }
    
    if (mode && mode !== 'all') {
      const modeValue = mode.charAt(0).toUpperCase() + mode.slice(1);
      console.log('Applying mode filter:', modeValue);
      q = q.where('mode', '==', modeValue);
      filterCount++;
    }

    // Date filtering
    if (dateFilter === 'today') {
      console.log('Filtering for today:', todayStr);
      q = q.where('date', '==', todayStr);
      filterCount++;
    } else if (dateFilter === 'tomorrow') {
      console.log('Filtering for tomorrow:', tomorrowStr);
      q = q.where('date', '==', tomorrowStr);
      filterCount++;
    } else if (dateFilter === 'previous') {
      console.log('Filtering for previous dates before:', todayStr);
      q = q.where('date', '<', todayStr);
      filterCount++;
    } else if (dateFilter === 'upcoming') {
      console.log('Filtering for upcoming dates from:', tomorrowStr);
      q = q.where('date', '>=', tomorrowStr);
      filterCount++;
    } else if (dateFilter === 'this_week') {
      const weekStart = new Date(today);
      weekStart.setUTCDate(today.getUTCDate() - today.getUTCDay());
      const weekEnd = new Date(weekStart);
      weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
      
      const weekStartStr = weekStart.toISOString().split('T')[0];
      const weekEndStr = weekEnd.toISOString().split('T')[0];
      
      console.log('Filtering for this week:', weekStartStr, 'to', weekEndStr);
      q = q.where('date', '>=', weekStartStr).where('date', '<=', weekEndStr);
      filterCount += 2;
    } else if (dateFilter === 'next_week') {
      const nextWeekStart = new Date(today);
      nextWeekStart.setUTCDate(today.getUTCDate() + (7 - today.getUTCDay()));
      const nextWeekEnd = new Date(nextWeekStart);
      nextWeekEnd.setUTCDate(nextWeekStart.getUTCDate() + 6);
      
      const nextWeekStartStr = nextWeekStart.toISOString().split('T')[0];
      const nextWeekEndStr = nextWeekEnd.toISOString().split('T')[0];
      
      console.log('Filtering for next week:', nextWeekStartStr, 'to', nextWeekEndStr);
      q = q.where('date', '>=', nextWeekStartStr).where('date', '<=', nextWeekEndStr);
      filterCount += 2;
    } else if (startDate && endDate) {
      console.log('Filtering for custom date range:', startDate, 'to', endDate);
      q = q.where('date', '>=', startDate).where('date', '<=', endDate);
      filterCount += 2;
    }

    console.log('Total filters applied:', filterCount);

    // Fetch ALL matching documents (no pagination yet)
    console.log('Fetching all matching documents...');
    const snap = await q.get();
    let allLectures = snap.docs.map(d => ({id: d.id, ...d.data()}));
    
    console.log('Found', allLectures.length, 'total matching lectures');

    // SERVER-SIDE SORTING FUNCTION
    function sortLecturesServerSide(lectures) {
      return lectures.slice().sort((a, b) => {
        // Today's lectures first
        if (a.date === todayStr && b.date !== todayStr) return -1;
        if (b.date === todayStr && a.date !== todayStr) return 1;
        
        // Tomorrow's lectures second (but after today)
        if (a.date === tomorrowStr && b.date !== tomorrowStr && b.date !== todayStr) return -1;
        if (b.date === tomorrowStr && a.date !== tomorrowStr && a.date !== todayStr) return 1;

        // Future dates (after tomorrow) - ascending order
        if (a.date > todayStr && b.date > todayStr) {
          return new Date(a.date) - new Date(b.date);
        }
        
        // Past dates - descending order (most recent first)
        if (a.date < todayStr && b.date < todayStr) {
          return new Date(b.date) - new Date(a.date);
        }

        // Mixed future/past: future comes first
        return a.date > todayStr ? -1 : 1;
      });
    }

    // Sort the complete dataset
    console.log('Sorting all lectures...');
    allLectures = sortLecturesServerSide(allLectures);

    // Now apply pagination to the sorted results
    const totalCount = allLectures.length;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedLectures = allLectures.slice(startIndex, endIndex);

    console.log(`Pagination: page ${page}, showing ${startIndex}-${endIndex} of ${totalCount}`);

    const response = {
      lectures: paginatedLectures,
      currentPage: page,
      totalCount: totalCount,
      totalPages: Math.ceil(totalCount / limit),
      hasMore: endIndex < totalCount,
      serverDate: todayStr
    };

    console.log('Sending successful response with', paginatedLectures.length, 'lectures');
    res.json(response);
    
  } catch (e) {
    console.error('=== LECTURES API ERROR ===');
    console.error('Error type:', e.constructor.name);
    console.error('Error message:', e.message);
    console.error('Error code:', e.code);
    console.error('Full error:', e);
    
    res.status(500).json({
      error: 'Failed to fetch lectures',
      details: e.message,
      code: e.code,
      type: e.constructor.name
    });
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
/*---------- ANNOUNCEMENTS ---------------------------------*/
r.get('/announcements', async (req, res) => {
  try {
    const snap = await db.collection('announcements')
                         .orderBy('createdAt', 'desc')
                         .get();
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch announcements' });
  }
});

r.post('/announcements', async (req, res) => {
  const ref = await db.collection('announcements').add({
    ...req.body,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  res.status(201).json({ id: ref.id });
});

r.put('/announcements/:id', async (req, res) => {
  await db.collection('announcements')
          .doc(req.params.id)
          .set(req.body, { merge: true });
  res.json({ id: req.params.id });
});

r.delete('/announcements/:id', async (req, res) => {
  await db.collection('announcements').doc(req.params.id).delete();
  res.sendStatus(204);
});

r.get('/announcements/:id', async (req, res) => {
  const doc = await db.collection('announcements').doc(req.params.id).get();
  if (!doc.exists) return res.status(404).json({ error: 'Announcement not found' });
  res.json({ id: doc.id, ...doc.data() });
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
