require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.local') });
const admin = require('firebase-admin');
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }),
  });
}
const db = admin.firestore();

const NUMBER = process.argv[2] || '8291754256';

async function run() {
  const now = new Date();
  const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const d = String(ist.getUTCDate()).padStart(2, '0');
  const dk = `${y}-${m}-${d}`;

  const ref = db.collection('studentattendance').doc(NUMBER);
  const snap = await ref.get();

  if (!snap.exists) {
    console.log(`No attendance doc for ${NUMBER}`);
    return;
  }

  const data = snap.data();
  const day = data?.days?.[dk];
  console.log(`\nDoc ID: ${NUMBER}`);
  console.log(`Today's key: ${dk}`);
  console.log(`Today's data:`, JSON.stringify(day, null, 2));
  console.log(`\nAll day keys:`, Object.keys(data?.days || {}));
  console.log(`\nsummary:`, JSON.stringify(data?.summary, null, 2));
}

run().catch(e => console.error(e.message));
