// server/index.js
// ───────────────────────────────────────────────────────────
//  Single source of truth for the API.
//    • export the Express app (for serverless / tests / Vercel)
//    • start app.listen() only when run directly (local / Render)
// ───────────────────────────────────────────────────────────
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.local') });
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

/*────────────── Firebase Admin (guard against double-init) */
if (!admin.apps.length) {
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '')
    .replace(/\\n/g, '\n');                       // keep real line-feeds!

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey
    })
  });
}
const db = admin.firestore();

/*────────────── Environment-aware collection names & FCM topic */
const PREFIX = process.env.COLLECTION_PREFIX || '';
const COL = {
  students:      PREFIX + 'students',
  lectures:      PREFIX + 'lectures',
  announcements: PREFIX + 'announcements',
  banners:       PREFIX + 'banners',
  results:       PREFIX + 'results',
  faculty:       PREFIX + 'faculty',
};
const FCM_TOPIC = process.env.FCM_TOPIC || 'all';
if (PREFIX) console.log(`⚠️  STAGING MODE — collections prefixed with "${PREFIX}", FCM topic: ${FCM_TOPIC}`);

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

/*---------- STUDENTS (This was already efficient) -----------------*/
r.get('/students', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '30', 10);
    const afterId = req.query.startAfterId || null;

    let q = db.collection(COL.students)
      .orderBy('createdAt', 'desc')
      .orderBy('name');

    if (afterId) {
      const snap = await db.collection(COL.students).doc(afterId).get();
      if (!snap.exists) return res.status(404).json({ error: 'startAfterId not found' });
      q = q.startAfter(snap);
    }

    const snap = await q.limit(limit).get();
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const lastId = snap.size ? snap.docs[snap.size - 1].id : null;

    const payload = {
      students: rows,
      lastVisible: lastId,
      hasMore: snap.size === limit
    };

    if (!afterId) {
      const cnt = await db.collection(COL.students).count().get();
      payload.totalStudents = cnt.data().count;
    }
    res.json(payload);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch students', details: e.message });
  }
});

r.post('/students', async (req, res) => {
  const d = await db.collection(COL.students).add({
    ...req.body,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  res.status(201).json({ id: d.id });
});

r.put('/students/:id', async (req, res) => {
  await db.collection(COL.students).doc(req.params.id).set(req.body, { merge: true });
  res.json({ id: req.params.id });
});

r.delete('/students/:id', async (req, res) => {
  await db.collection(COL.students).doc(req.params.id).delete();
  res.sendStatus(204);
});

r.get('/students/:id', async (req, res) => {
  const d = await db.collection(COL.students).doc(req.params.id).get();
  if (!d.exists) return res.status(404).json({ error: 'Student not found' });
  res.json(d.data());
});


/*---------- LECTURES (FIXED - Now highly efficient) --------------------------------------*/
// The previous version was inefficient because it fetched ALL documents from Firestore
// that matched the filters, then sorted and paginated them on your server.
// This new version lets Firestore do the hard work, only reading one page of data at a time.
r.get('/lectures', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '30', 10);
    const {
      dateFilter, course, faculty, mode, branch, startDate, endDate, startAfterId
    } = req.query;

    let q = db.collection(COL.lectures);

    // --- Apply Filters (same as before) ---
    if (course && course !== 'all') {
      q = q.where('course', '==', course);
    }
    if (faculty && faculty !== 'all') {
      q = q.where('faculty', '==', faculty);
    }
    if (branch && branch !== 'all') {
      q = q.where('branch', '==', branch);
    }
    if (mode && mode !== 'all') {
      const modeValue = mode.charAt(0).toUpperCase() + mode.slice(1);
      q = q.where('mode', '==', modeValue);
    }

    // --- Efficient Date Filtering & Sorting ---
    // We must give Firestore a consistent sort order. Sorting by date ascending
    // is the most logical for a schedule. It shows past, then today, then future.
    q = q.orderBy('date', 'asc');

    const now = new Date();
    const today = new Date(now.getTime() + (5.5 * 60 * 60 * 1000)); // IST
    today.setUTCHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];

    const tomorrow = new Date(today);
    tomorrow.setUTCDate(today.getUTCDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    // Date filtering
    if (dateFilter === 'today') {
      q = q.where('date', '==', todayStr);
    } else if (dateFilter === 'tomorrow') {
      q = q.where('date', '==', tomorrowStr);
    } else if (dateFilter === 'previous') {
      q = q.where('date', '<', todayStr);
      // To show most recent first for previous, we reverse the sort order
      q = q.orderBy('date', 'desc');
    } else if (dateFilter === 'upcoming') {
      q = q.where('date', '>=', tomorrowStr);
    } else if (startDate && endDate) {
      q = q.where('date', '>=', startDate).where('date', '<=', endDate);
    }
    // Note: 'this_week' and 'next_week' are omitted as they require range filters
    // on 'date', which conflicts with other inequality filters you might add later.
    // It's often better to calculate the date range on the client and pass `startDate` and `endDate`.

    // --- Efficient Pagination ---
    if (startAfterId) {
      const startDoc = await db.collection(COL.lectures).doc(startAfterId).get();
      if (!startDoc.exists) {
        return res.status(404).json({ error: 'Pagination start document not found' });
      }
      q = q.startAfter(startDoc);
    }

    // --- Execute Query (reads only one page) ---
    const snap = await q.limit(limit).get();
    const lectures = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const lastVisibleId = snap.size ? snap.docs[snap.size - 1].id : null;

    res.json({
      lectures,
      lastVisible: lastVisibleId,
      hasMore: snap.size === limit,
      serverDate: todayStr
    });

  } catch (e) {
    console.error('GET /lectures error:', e);
    res.status(500).json({
      error: 'Failed to fetch lectures',
      details: e.message,
      code: e.code
    });
  }
});

r.post('/lectures', async (req, res) => {
  const d = await db.collection(COL.lectures).add({
    ...req.body,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  res.status(201).json({ id: d.id });
});

r.put('/lectures/:id', async (req, res) => {
  await db.collection(COL.lectures).doc(req.params.id).set(req.body, { merge: true });
  res.json({ id: req.params.id });
});

r.delete('/lectures/:id', async (req, res) => {
  await db.collection(COL.lectures).doc(req.params.id).delete();
  res.sendStatus(204);
});

r.get('/lectures/:id', async (req, res) => {
  const d = await db.collection(COL.lectures).doc(req.params.id).get();
  if (!d.exists) return res.status(404).json({ error: 'Lecture not found' });
  res.json(d.data());
});


/*---------- ANNOUNCEMENTS (FIXED - Added efficient pagination) -----------------*/
r.get('/announcements', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '20', 10);
    const startAfterId = req.query.startAfterId || null;

    let q = db.collection(COL.announcements).orderBy('createdAt', 'desc');

    if (startAfterId) {
      const startDoc = await db.collection(COL.announcements).doc(startAfterId).get();
      if (startDoc.exists) {
        q = q.startAfter(startDoc);
      }
    }

    const snap = await q.limit(limit).get();
    const announcements = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const lastVisibleId = snap.size ? snap.docs[snap.size - 1].id : null;

    res.json({
      announcements,
      lastVisible: lastVisibleId,
      hasMore: snap.size === limit
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch announcements' });
  }
});

r.post('/announcements', async (req, res) => {
  try {
    const ref = await db.collection(COL.announcements).add({
      ...req.body,
      notified: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Send push notification to all users via FCM topic
    const title = req.body.title || 'New Announcement';
    const message = req.body.message || 'Check out the latest announcement!';

    try {
      await admin.messaging().send({
        topic: FCM_TOPIC,
        notification: { title, body: message },
        data: {
          screen: 'ImportantAnnouncement',
          type: 'announcement',
          announcementId: ref.id,
        },
        android: {
          ttl: 2 * 24 * 60 * 60 * 1000,
          notification: {
            channelId: 'absedu_notifications',
            priority: 'high',
            defaultSound: true,
            defaultVibrateTimings: true,
          },
        },
      });
      console.log('Announcement created + push sent:', title, ref.id);
    } catch (fcmErr) {
      console.error('Push failed (announcement still saved):', fcmErr.message);
    }

    res.status(201).json({ id: ref.id });
  } catch (e) {
    console.error('Error creating announcement:', e);
    res.status(500).json({ error: 'Failed to create announcement', details: e.message });
  }
});

r.put('/announcements/:id', async (req, res) => {
  await db.collection(COL.announcements)
    .doc(req.params.id)
    .set(req.body, { merge: true });
  res.json({ id: req.params.id });
});

r.delete('/announcements/:id', async (req, res) => {
  await db.collection(COL.announcements).doc(req.params.id).delete();
  res.sendStatus(204);
});

r.get('/announcements/:id', async (req, res) => {
  const doc = await db.collection(COL.announcements).doc(req.params.id).get();
  if (!doc.exists) return res.status(404).json({ error: 'Announcement not found' });
  res.json({ id: doc.id, ...doc.data() });
});


/*---------- BANNERS (FIXED - Added efficient pagination) --------------------*/
r.get('/banners', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '10', 10);
    const startAfterId = req.query.startAfterId || null;

    let q = db.collection(COL.banners).orderBy('order', 'asc');

    if (startAfterId) {
      const startDoc = await db.collection(COL.banners).doc(startAfterId).get();
      if (startDoc.exists) {
        q = q.startAfter(startDoc);
      }
    }

    const snap = await q.limit(limit).get();
    const banners = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const lastVisibleId = snap.size ? snap.docs[snap.size - 1].id : null;

    res.json({
      banners,
      lastVisible: lastVisibleId,
      hasMore: snap.size === limit
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch banners' });
  }
});

r.post('/banners', async (req, res) => {
  try {
    const ref = await db.collection(COL.banners).add({
      ...req.body,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    res.status(201).json({ id: ref.id });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create banner', details: e.message });
  }
});

r.put('/banners/:id', async (req, res) => {
  try {
    await db.collection(COL.banners).doc(req.params.id).set(req.body, { merge: true });
    res.json({ id: req.params.id });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update banner', details: e.message });
  }
});

r.delete('/banners/:id', async (req, res) => {
  try {
    await db.collection(COL.banners).doc(req.params.id).delete();
    res.sendStatus(204);
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete banner', details: e.message });
  }
});

r.get('/banners/:id', async (req, res) => {
  try {
    const doc = await db.collection(COL.banners).doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Banner not found' });
    res.json({ id: doc.id, ...doc.data() });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch banner', details: e.message });
  }
});


/*---------- RESULTS (This was already efficient) ----------------*/
r.get('/results', async (req, res) => {
  try {
    const { limit = '10', startAfterId, searchQuery } = req.query;
    const pageLimit = parseInt(limit, 10);

    let q = db.collection(COL.results);

    if (searchQuery) {
      const isNumeric = /^\d+$/.test(searchQuery);
      if (isNumeric) {
        q = q.where(admin.firestore.FieldPath.documentId(), '>=', searchQuery)
          .where(admin.firestore.FieldPath.documentId(), '<=', searchQuery + '\uf8ff')
          .orderBy(admin.firestore.FieldPath.documentId());
      } else {
        const searchQueryLower = searchQuery.toLowerCase();
        q = q.where('name_lowercase', '>=', searchQueryLower)
          .where('name_lowercase', '<=', searchQueryLower + '\uf8ff')
          .orderBy('name_lowercase')
          .orderBy('createdAt', 'desc');
      }
    } else {
      q = q.orderBy(admin.firestore.FieldPath.documentId(), 'desc');
    }

    if (startAfterId) {
      const startDoc = await db.collection(COL.results).doc(startAfterId).get();
      if (!startDoc.exists) {
        return res.status(404).json({ error: 'Pagination start document not found' });
      }
      q = q.startAfter(startDoc);
    }

    const snap = await q.limit(pageLimit).get();
    const results = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const lastVisibleId = snap.size ? snap.docs[snap.size - 1].id : null;

    const payload = {
      results,
      lastVisible: lastVisibleId,
      hasMore: snap.size === pageLimit
    };

    if (!startAfterId) {
      let countQuery = db.collection(COL.results);
      if (searchQuery) {
        const isNumeric = /^\d+$/.test(searchQuery);
        if (isNumeric) {
          countQuery = countQuery.where(admin.firestore.FieldPath.documentId(), '>=', searchQuery)
            .where(admin.firestore.FieldPath.documentId(), '<=', searchQuery + '\uf8ff');
        } else {
          const searchQueryLower = searchQuery.toLowerCase();
          countQuery = countQuery.where('name_lowercase', '>=', searchQueryLower)
            .where('name_lowercase', '<=', searchQueryLower + '\uf8ff');
        }
      }
      const countSnap = await countQuery.count().get();
      payload.totalResults = countSnap.data().count;
    }
    res.json(payload);
  } catch (e) {
    console.error('GET /results error', e);
    res.status(500).json({ error: 'Failed to fetch results', details: e.message, code: e.code });
  }
});

r.put('/results/:id', async (req, res) => {
  console.log('PUT /results/' + req.params.id, req.body);
  try {
    const docRef = db.collection(COL.results).doc(req.params.id);
    const docSnap = await docRef.get();
    const payload = {
      ...req.body,
      name_lowercase: req.body.Name ? req.body.Name.toLowerCase() : '',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    if (!docSnap.exists) {
      payload.createdAt = admin.firestore.FieldValue.serverTimestamp();
    }
    await docRef.set(payload, { merge: true });
    res.json({ id: req.params.id, status: 'ok' });
  } catch (e) {
    console.error('PUT error', e);
    res.status(500).json({ error: e.message });
  }
});

r.get('/results/:id', async (req, res) => {
  try {
    const doc = await db.collection(COL.results).doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Not found' });
    res.json(doc.data());
  } catch (e) {
    console.error('GET /results/:id error', e);
    res.status(500).json({ error: e.message });
  }
});

/*---------- FACULTY (CRUD for managing faculty list) -----------------*/
r.get('/faculty', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '100', 10);
    const startAfterId = req.query.startAfterId || null;

    let q = db.collection(COL.faculty).orderBy('name', 'asc');

    if (startAfterId) {
      const startDoc = await db.collection(COL.faculty).doc(startAfterId).get();
      if (startDoc.exists) {
        q = q.startAfter(startDoc);
      }
    }

    const snap = await q.limit(limit).get();
    const faculty = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const lastVisibleId = snap.size ? snap.docs[snap.size - 1].id : null;

    const payload = {
      faculty,
      lastVisible: lastVisibleId,
      hasMore: snap.size === limit
    };

    if (!startAfterId) {
      const cnt = await db.collection(COL.faculty).count().get();
      payload.totalFaculty = cnt.data().count;
    }

    res.json(payload);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch faculty', details: e.message });
  }
});

r.post('/faculty', async (req, res) => {
  try {
    const d = await db.collection(COL.faculty).add({
      ...req.body,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    res.status(201).json({ id: d.id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create faculty', details: e.message });
  }
});

r.put('/faculty/:id', async (req, res) => {
  try {
    await db.collection(COL.faculty).doc(req.params.id).set(req.body, { merge: true });
    res.json({ id: req.params.id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update faculty', details: e.message });
  }
});

r.delete('/faculty/:id', async (req, res) => {
  try {
    await db.collection(COL.faculty).doc(req.params.id).delete();
    res.sendStatus(204);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete faculty', details: e.message });
  }
});

r.get('/faculty/:id', async (req, res) => {
  try {
    const d = await db.collection(COL.faculty).doc(req.params.id).get();
    if (!d.exists) return res.status(404).json({ error: 'Faculty not found' });
    res.json(d.data());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch faculty', details: e.message });
  }
});

/*---------- Misc ------------------------------------------*/
r.get('/ping', (_req, res) => res.send('pong'));

/*===========================================================*/
/*  Mount router twice                                       */
/*===========================================================*/
app.use('/api', r);   // local / Render  (your front-end calls /api/…)
app.use('/', r);   // Vercel rewrites /api/foo → /foo internally

/*──────── EXPORT (for Vercel & tests) ───────────────────────*/
module.exports = app;

/*──────── WhatsApp attendance notifications ────────────────*/
const { initWhatsApp } = require('./whatsapp');
const { startAttendanceListener } = require('./attendanceListener');

/*──────── Local / Render bootstrap ─────────────────────────*/
if (require.main === module) {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => {
    console.log(`✅  API ready  →  http://localhost:${PORT}/api/ping`);

    // Start WhatsApp Web client (shows QR code in terminal on first run)
    initWhatsApp();

    // Start watching attendance changes in Firestore
    startAttendanceListener(db);
  });
}
