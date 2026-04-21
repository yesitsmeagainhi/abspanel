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
db.collection('students').get().then(snap => {
  console.log('\nAdmin & SuperAdmin users:\n');
  console.log('Role          | Name                     | Number       | Branch');
  console.log('-'.repeat(75));
  snap.docs.forEach(doc => {
    const d = doc.data();
    const role = (d.Role || '').toLowerCase();
    if (role === 'admin' || role === 'superadmin') {
      console.log(
        (d.Role || '-').padEnd(14) + '| ' +
        (d.name || '-').padEnd(25) + '| ' +
        (d.number || '-').padEnd(13) + '| ' +
        (d.Faculty || d.branch || '-')
      );
    }
  });
  console.log('');
}).catch(e => console.error(e.message));
