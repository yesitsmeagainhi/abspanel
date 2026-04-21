// scripts/delete-students.js
// Usage:
//   node scripts/delete-students.js preview    ← shows matching records (safe)
//   node scripts/delete-students.js delete     ← actually deletes them

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.local') });
const admin = require('firebase-admin');

if (!admin.apps.length) {
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
  });
}
const db = admin.firestore();

// --- CONFIGURATION ---
const COLLECTION = 'students';  // production collection
const BATCH_VALUE = 'D- Batch D.Pharm';
const COURSE_VALUE = 'D.Pharm';

async function run() {
  const mode = process.argv[2] || 'preview';

  console.log(`\nSearching "${COLLECTION}" for batch="${BATCH_VALUE}" and course containing "pharm"...\n`);

  // Query all students and filter flexibly (handles slight variations in field values)
  const snap = await db.collection(COLLECTION).get();
  const matches = [];

  snap.docs.forEach(doc => {
    const d = doc.data();
    const batch = (d.batch || '').trim();
    const course = (d.course || '').trim().toLowerCase();

    // Match exact batch and course values
    if (batch === BATCH_VALUE && d.course?.trim() === COURSE_VALUE) {
      matches.push({ id: doc.id, name: d.name, number: d.number, batch: d.batch, course: d.course });
    }
  });

  if (matches.length === 0) {
    console.log('No matching students found. Check field values in Firestore.\n');
    console.log('Sample of first 5 students for reference:');
    snap.docs.slice(0, 5).forEach(doc => {
      const d = doc.data();
      console.log(`  batch="${d.batch}" | course="${d.course}" | name="${d.name}"`);
    });
    return;
  }

  console.log(`Found ${matches.length} matching student(s):\n`);
  console.log('ID                      | Name                | Number      | Batch | Course');
  console.log('-'.repeat(90));
  matches.forEach(m => {
    console.log(`${m.id.padEnd(24)}| ${(m.name || '-').padEnd(20)}| ${(m.number || '-').padEnd(12)}| ${(m.batch || '-').padEnd(6)}| ${m.course || '-'}`);
  });

  if (mode === 'preview') {
    console.log(`\n--- PREVIEW ONLY (no changes made) ---`);
    console.log(`To delete these ${matches.length} records, run:\n`);
    console.log(`  node scripts/delete-students.js delete\n`);
    return;
  }

  if (mode === 'delete') {
    console.log(`\nDeleting ${matches.length} student(s)...`);
    const batch = db.batch();
    matches.forEach(m => {
      batch.delete(db.collection(COLLECTION).doc(m.id));
    });
    await batch.commit();
    console.log(`Done! ${matches.length} student(s) deleted from "${COLLECTION}".\n`);
  }
}

run().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
