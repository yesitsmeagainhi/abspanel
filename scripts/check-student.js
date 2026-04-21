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

const NUMBER = '8291754256';

async function run() {
  // Search by number field
  const snap = await db.collection('students').where('number', '==', NUMBER).get();

  if (snap.empty) {
    console.log(`\nNo student found with number="${NUMBER}" in "students" collection.\n`);

    // Check if it exists with different formatting
    const allSnap = await db.collection('students').get();
    const partial = [];
    allSnap.docs.forEach(doc => {
      const d = doc.data();
      if ((d.number || '').includes('8291') || (d.number || '').includes('4256')) {
        partial.push({ id: doc.id, number: d.number, name: d.name, password: d.password });
      }
    });

    if (partial.length > 0) {
      console.log('Partial matches found:');
      partial.forEach(p => console.log(`  ID: ${p.id} | number: "${p.number}" | name: ${p.name} | password: "${p.password}"`));
    }
  } else {
    snap.docs.forEach(doc => {
      const d = doc.data();
      console.log('\nStudent found:');
      console.log('  Doc ID:', doc.id);
      console.log('  number:', JSON.stringify(d.number));
      console.log('  password:', JSON.stringify(d.password));
      console.log('  name:', d.name);
      console.log('  course:', d.course);
      console.log('  batch:', d.batch);
      console.log('  branch:', d.branch);
      console.log('  Role:', d.Role);
      console.log('');
    });
  }
}

run().catch(e => console.error(e.message));
