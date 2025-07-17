// scripts/backfillCreatedAt.js  (full file)

require('dotenv').config();                     //  ←  add this
const admin = require('firebase-admin');

const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

admin.initializeApp({                           //  ←  identical to server/index.js
  credential: admin.credential.cert({
    projectId  : process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey
  })
});

const db = admin.firestore();

(async () => {
  const snap = await db.collection('students').get();
  const batch = db.batch();
  let updated = 0;

  snap.docs.forEach(doc => {
    if (!doc.data().createdAt) {
      batch.update(doc.ref, {
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      updated++;
    }
  });

  if (updated) await batch.commit();
  console.log(`Back-filled createdAt on ${updated} of ${snap.size} docs`);
  process.exit(0);
})();
