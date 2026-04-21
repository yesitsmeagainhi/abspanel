// Fix the two mis-corrected lecture dates
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

const fixes = {
  '00nIiegg881Av9AgFtOi': '2026-04-22',  // was 20206-04-22 → wrongly set to 2020
  'GcZoT6eYgz7vSxhysbJY': '2026-04-24'   // was 42026-04-24 → wrongly set to 4202
};

(async () => {
  for (const [id, correctDate] of Object.entries(fixes)) {
    const ref = db.collection('lectures').doc(id);
    const doc = await ref.get();
    if (doc.exists) {
      const old = doc.data().date;
      await ref.update({ date: correctDate });
      console.log(`  ${id}: "${old}" → "${correctDate}"`);
    }
  }
  console.log('\nDone. Both dates corrected to 2026.');
  process.exit(0);
})();
