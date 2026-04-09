// Quick inspection: what fields do student docs actually have?
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
  const snap = await db.collection('students').limit(5).get();
  snap.forEach(d => {
    console.log(`\n--- Doc ID: ${d.id} ---`);
    const data = d.data();
    Object.keys(data).sort().forEach(k => {
      const v = data[k];
      const preview = typeof v === 'object' ? JSON.stringify(v).slice(0, 60) : String(v).slice(0, 60);
      console.log(`  ${k.padEnd(20)} = ${preview}`);
    });
  });

  // Also count how many students have various phone-ish fields
  const all = await db.collection('students').get();
  const fieldCounts = {};
  all.forEach(d => {
    const data = d.data();
    Object.keys(data).forEach(k => {
      if (/phone|mobile|contact|number/i.test(k)) {
        fieldCounts[k] = (fieldCounts[k] || 0) + (data[k] ? 1 : 0);
      }
    });
  });
  console.log('\n--- phone-ish fields across all students (non-empty values) ---');
  Object.keys(fieldCounts).sort().forEach(k => console.log(`  ${k}: ${fieldCounts[k]}`));

  // Check if doc ID itself is phone-like
  let phoneIds = 0;
  let nonPhoneIds = 0;
  all.forEach(d => {
    if (/^\d{10,15}$/.test(d.id)) phoneIds++;
    else nonPhoneIds++;
  });
  console.log(`\n--- student doc IDs ---`);
  console.log(`  phone-like (10-15 digits): ${phoneIds}`);
  console.log(`  other                    : ${nonPhoneIds}`);

  process.exit(0);
})();
