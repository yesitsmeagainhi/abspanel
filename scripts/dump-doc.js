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
const NUMBER = process.argv[2] || '7798045512';

async function run() {
  const ref = db.collection('studentattendance').doc(NUMBER);
  const snap = await ref.get();
  if (!snap.exists) {
    console.log('Doc not found');
    return;
  }
  console.log('\nFull document dump:\n');
  console.log(JSON.stringify(snap.data(), null, 2));
}

run().catch(e => console.error(e.message));
