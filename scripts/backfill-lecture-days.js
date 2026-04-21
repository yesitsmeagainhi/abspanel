// Backfill the `day` field on all existing lecture docs based on their `date` field.
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.local') });
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n')
    })
  });
}

const db = admin.firestore();

const getDayName = (d) => {
  if (!d || d.length !== 10) return '';
  const dt = new Date(d + 'T00:00:00');
  return isNaN(dt) ? '' : dt.toLocaleDateString('en-IN', { weekday: 'long' });
};

(async () => {
  const snap = await db.collection('lectures').get();
  console.log(`Total lectures: ${snap.size}`);

  let batch = db.batch();
  let n = 0;
  let updated = 0;
  let skipped = 0;

  snap.forEach(doc => {
    const data = doc.data();
    const date = data.date || '';
    const day = getDayName(date);

    if (!day) {
      skipped++;
      return;
    }

    batch.update(doc.ref, { day });
    n++;
    updated++;

    if (n >= 400) {
      // commit synchronously below
    }
  });

  // Commit in chunks
  const docs = snap.docs.filter(d => {
    const date = d.data().date || '';
    return getDayName(date) !== '';
  });

  let writeBatch = db.batch();
  let count = 0;
  let total = 0;

  for (const doc of docs) {
    const day = getDayName(doc.data().date);
    writeBatch.update(doc.ref, { day });
    count++;
    total++;

    if (count >= 400) {
      await writeBatch.commit();
      console.log(`  Committed ${count} (running total: ${total})`);
      writeBatch = db.batch();
      count = 0;
    }
  }

  if (count > 0) {
    await writeBatch.commit();
    console.log(`  Committed ${count} (running total: ${total})`);
  }

  console.log(`\nDone. Updated ${total} lectures, skipped ${snap.size - total} (no valid date).`);
  process.exit(0);
})();
