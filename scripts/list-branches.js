// Quick script to list branches and batches from config/appData
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

(async () => {
  try {
    const snap = await db.collection('config').doc('appData').get();
    if (!snap.exists) {
      console.log('config/appData document does not exist.');
      process.exit(0);
    }
    const data = snap.data();
    const branches = data.branches || [];
    const batches  = data.batches  || [];

    console.log('\n========== BRANCHES ==========');
    console.log(`Total: ${branches.length}`);
    branches.sort().forEach((b, i) => console.log(`  ${i + 1}. ${b}`));

    console.log('\n========== BATCHES ==========');
    console.log(`Total: ${batches.length}`);
    batches.sort().forEach((b, i) => console.log(`  ${i + 1}. ${b}`));

    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
