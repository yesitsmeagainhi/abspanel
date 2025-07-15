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

// MODIFIED: GET /api/lectures to include pagination and filtering
app.get('/api/lectures', async (req, res) => {
    try {
        const limitNum = parseInt(req.query.limit || '30', 10);
        const startAfterDocId = req.query.startAfter; // This will be the ID of the last document from previous fetch

        // Filter parameters
        const courseFilter = req.query.course;
        const facultyFilter = req.query.faculty;
        const modeFilter = req.query.mode;
        const dateFilter = req.query.dateFilter; // 'today', 'previous', 'upcoming'

        let query = db.collection('lectures').orderBy('date', 'asc'); // Always order for consistent pagination

        // Apply filters
        if (courseFilter && courseFilter !== 'all') {
            query = query.where('course', '==', courseFilter);
        }
        if (facultyFilter && facultyFilter !== 'all') {
            query = query.where('faculty', '==', facultyFilter);
        }
        if (modeFilter && modeFilter !== 'all') {
            query = query.where('mode', '==', modeFilter.charAt(0).toUpperCase() + modeFilter.slice(1)); // Capitalize first letter
        }

        // Apply date filters (requires careful indexing and range queries)
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Start of today
        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1); // Start of tomorrow

        if (dateFilter === 'today') {
            query = query.where('date', '==', today.toISOString().split('T')[0]); // Assuming date stored as 'YYYY-MM-DD' string
            // NOTE: If 'date' is stored as a Firestore Timestamp, you'd use:
            // query = query.where('date', '>=', today).where('date', '<', tomorrow);
        } else if (dateFilter === 'previous') {
            query = query.where('date', '<', today.toISOString().split('T')[0]);
            // For Timestamp: query = query.where('date', '<', today);
        } else if (dateFilter === 'upcoming') {
            query = query.where('date', '>=', tomorrow.toISOString().split('T')[0]);
            // For Timestamp: query = query.where('date', '>=', tomorrow);
        }
        // IMPORTANT: Combining multiple range queries (e.g., date + another field) requires a composite index.

        // Apply pagination
        if (startAfterDocId) {
            const startAfterSnap = await db.collection('lectures').doc(startAfterDocId).get();
            if (startAfterSnap.exists) {
                query = query.startAfter(startAfterSnap);
            } else {
                return res.status(404).json({ error: 'startAfter document not found' });
            }
        }

        const snap = await query.limit(limitNum).get();
        const lectures = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        let lastVisibleId = null;
        if (snap.docs.length > 0) {
            lastVisibleId = snap.docs[snap.docs.length - 1].id;
        }

        // Return lectures and the last document ID for the next pagination request
        res.json({
            lectures,
            lastVisible: lastVisibleId,
            hasMore: snap.docs.length === limitNum // Indicate if there might be more pages
        });

    } catch (error) {
        console.error('Error fetching lectures:', error);
        res.status(500).json({ error: 'Failed to fetch lectures', details: error.message });
    }
});

// Existing POST, PUT, DELETE remain the same for lectures
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
app.get('/api/lectures/:id', async (req, res) => {
  const doc = await db.collection('lectures').doc(req.params.id).get();
  if (!doc.exists) {
      return res.status(404).json({ error: 'Lecture not found' });
  }
  res.json(doc.data());
});


/* ---------- Students CRUD (Your existing pagination for students) ---------- */
app.get('/api/students', async (req, res) => {
    try {
        const page = parseInt(req.query.page || '1', 10);
        const limit = parseInt(req.query.limit || '30', 10);

        let query = db.collection('students').orderBy('name').limit(limit);

        // For cursor-based pagination (modified to use startAfter document reference for efficiency)
        if (req.query.startAfterId) { // Use a specific query parameter for startAfter ID
            const startAfterDoc = await db.collection('students').doc(req.query.startAfterId).get();
            if (startAfterDoc.exists) {
                query = db.collection('students').orderBy('name').startAfter(startAfterDoc);
            } else {
                 return res.status(404).json({ error: 'startAfterId document not found for students' });
            }
        } else if (page > 1) { // Fallback for page number-based offset (less efficient)
            // Calculate offset by skipping (page - 1) * limit
            const offsetSnapshot = await db.collection('students').orderBy('name').limit((page - 1) * limit).get();
            const lastVisible = offsetSnapshot.docs[offsetSnapshot.docs.length - 1];
            if (lastVisible) {
                query = db.collection('students').orderBy('name').startAfter(lastVisible).limit(limit); // Pass the document snapshot directly
            } else {
                 // If no lastVisible doc for offset, means no more results or invalid page
                 return res.json([]); // Return empty for subsequent pages if nothing found
            }
        }


        const snap = await query.get();
        const students = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        let lastVisibleId = null;
        if (snap.docs.length > 0) {
            lastVisibleId = snap.docs[snap.docs.length - 1].id;
        }

        res.json({
            students,
            lastVisible: lastVisibleId,
            hasMore: snap.docs.length === limit // Indicate if there might be more pages
        });

    } catch (error) {
        console.error('Pagination error:', error);
        res.status(500).json({ error: 'Failed to fetch students with pagination' });
    }
});


// Existing POST, PUT, DELETE for students
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
app.get('/api/students/:id', async (req, res) => {
  const doc = await db.collection('students').doc(req.params.id).get();
  res.json(doc.data());
});


/* ---------- Announcements CRUD ---------- */
// ... (No changes needed here unless you also want to paginate/filter announcements)
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
// ... (No changes needed here unless you also want to paginate/filter banners)
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Dashboard running on http://localhost:${PORT}`));