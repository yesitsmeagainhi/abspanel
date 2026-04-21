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
  const snap = await db.collection('students').get();
  const byBranch = {};
  const byCourse = {};

  snap.forEach(d => {
    const data = d.data() || {};
    const branch = data.branch || data.Branch || '(no branch)';
    const course = data.course || data.Course || '(no course)';
    byBranch[branch] = (byBranch[branch] || 0) + 1;
    byCourse[course] = (byCourse[course] || 0) + 1;
  });

  console.log('=== Total Students Registered: ' + snap.size + ' ===\n');
  console.log('By Branch:');
  Object.keys(byBranch).sort((a, b) => byBranch[b] - byBranch[a]).forEach(b =>
    console.log('  ' + b.padEnd(20) + byBranch[b])
  );
  console.log('\nBy Course:');
  Object.keys(byCourse).sort((a, b) => byCourse[b] - byCourse[a]).forEach(c =>
    console.log('  ' + c.padEnd(20) + byCourse[c])
  );
  process.exit(0);
})();
