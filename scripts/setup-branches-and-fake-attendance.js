// Setup 6 branches, fix KURLA casing, generate fake attendance for non-Nalasopara
// Nalasopara's real attendance data is left untouched.
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
const Timestamp = admin.firestore.Timestamp;

const TARGET_BRANCHES = ['Andheri', 'Bhayandar', 'Kurla', 'Malad', 'Nalasopara', 'Thane'];

// Current month = April 2026
const FAKE_MONTH = '2026-04';
const FAKE_DAYS_FROM = 1;
const FAKE_DAYS_TO = 9; // Apr 1 to Apr 9 (today)
const ATTENDANCE_RATE = 1.0; // 100% — everyone present every day

function getDatesForMonth() {
  const dates = [];
  for (let d = FAKE_DAYS_FROM; d <= FAKE_DAYS_TO; d++) {
    dates.push(`${FAKE_MONTH}-${String(d).padStart(2, '0')}`);
  }
  return dates;
}

function makeFakeDayData(dateStr) {
  if (Math.random() > ATTENDANCE_RATE) return null; // absent

  // IST time base
  const baseDate = new Date(dateStr + 'T00:00:00+05:30');

  // In time: 8:30 AM - 10:00 AM IST
  const inHour = 8 + Math.floor(Math.random() * 2);
  const inMin = Math.floor(Math.random() * 60);
  const inDate = new Date(baseDate);
  inDate.setHours(inHour, inMin, 0, 0);

  // Out time: 4:00 PM - 6:30 PM IST
  const outHour = 16 + Math.floor(Math.random() * 3);
  const outMin = Math.floor(Math.random() * 60);
  const outDate = new Date(baseDate);
  outDate.setHours(outHour, outMin, 0, 0);

  return {
    hasIn: true,
    hasOut: true,
    inAt: Timestamp.fromDate(inDate),
    outAt: Timestamp.fromDate(outDate),
    inAtMs: inDate.getTime(),
    outAtMs: outDate.getTime()
  };
}

async function step1Peek() {
  console.log('\n=== STEP 1: Peek existing attendance structure ===');
  const snap = await db.collection('studentattendance').limit(2).get();
  snap.forEach(d => {
    const data = d.data();
    console.log(`Doc ID: ${d.id}`);
    console.log('  meta:', data.meta);
    const dayKeys = data.days ? Object.keys(data.days).slice(0, 1) : [];
    if (dayKeys.length > 0) console.log(`  sample day (${dayKeys[0]}):`, data.days[dayKeys[0]]);
  });
}

async function step2UpdateConfig(allBatches) {
  console.log('\n=== STEP 2: Update config/appData (branches + batches) ===');
  const configRef = db.collection('config').doc('appData');
  const configSnap = await configRef.get();
  const current = configSnap.data() || {};
  console.log('Current branches:', current.branches);
  console.log('Current batches:', current.batches);

  // Merge batches (keep existing + add any new ones from students)
  const existingBatches = current.batches || [];
  const mergedBatches = [...new Set([...existingBatches, ...allBatches])].filter(Boolean).sort();

  await configRef.set(
    { branches: TARGET_BRANCHES.slice().sort(), batches: mergedBatches },
    { merge: true }
  );
  console.log('✓ New branches:', TARGET_BRANCHES.slice().sort());
  console.log('✓ New batches:', mergedBatches);
}

async function step3FixKURLA() {
  console.log('\n=== STEP 3: Fix KURLA → Kurla ===');
  const snap = await db.collection('students').where('Branch', '==', 'KURLA').get();
  console.log(`Found ${snap.size} students with Branch=="KURLA"`);

  if (snap.size === 0) return;

  const batch = db.batch();
  snap.forEach(doc => batch.update(doc.ref, { Branch: 'Kurla' }));
  await batch.commit();
  console.log(`✓ Updated ${snap.size} students to Branch="Kurla"`);
}

async function step4GenerateFake() {
  console.log('\n=== STEP 4: Generate fake attendance for non-Nalasopara ===');

  const snap = await db.collection('students').get();
  console.log(`Total students: ${snap.size}`);

  const nonNalasopara = [];
  const batchesSet = new Set();

  snap.forEach(doc => {
    const d = doc.data();
    const branch = d.Branch || d.branch;
    const batchVal = d.Batch || d.batch;
    if (batchVal) batchesSet.add(batchVal);
    if (branch && branch !== 'Nalasopara' && TARGET_BRANCHES.includes(branch)) {
      nonNalasopara.push({ id: doc.id, ...d });
    }
  });

  console.log(`Non-Nalasopara students in target branches: ${nonNalasopara.length}`);

  const byBranch = {};
  nonNalasopara.forEach(s => {
    const b = s.Branch || s.branch;
    byBranch[b] = (byBranch[b] || 0) + 1;
  });
  Object.keys(byBranch).sort().forEach(b => console.log(`  ${b}: ${byBranch[b]}`));

  const dates = getDatesForMonth();
  console.log(`\nDate range: ${dates[0]} to ${dates[dates.length - 1]}  (${dates.length} days)`);

  // Commit in batches of 400
  let writeBatch = db.batch();
  let batchCount = 0;
  let totalWrites = 0;

  for (const student of nonNalasopara) {
    const studentName = student.Name || student.name || 'Unknown';
    const branch = student.Branch || student.branch;
    const batchVal = student.Batch || student.batch || 'F- Batch D.Pharm';
    const phone = student.Phone || student.phone || '';

    const days = {};
    for (const date of dates) {
      const dayData = makeFakeDayData(date);
      if (dayData) days[date] = dayData;
    }

    const attRef = db.collection('studentattendance').doc(student.id);
    writeBatch.set(attRef, {
      meta: { name: studentName, branch, batch: batchVal, phone },
      days
    }, { merge: true });

    batchCount++;
    totalWrites++;

    if (batchCount >= 400) {
      await writeBatch.commit();
      console.log(`  Committed ${batchCount} writes  (running total: ${totalWrites})`);
      writeBatch = db.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) {
    await writeBatch.commit();
    console.log(`  Committed ${batchCount} writes  (running total: ${totalWrites})`);
  }

  console.log(`\n✓ Generated fake attendance for ${totalWrites} students`);
  return [...batchesSet];
}

(async () => {
  try {
    await step1Peek();

    // Collect batches before step 2 (need them from students collection)
    const studentsSnap = await db.collection('students').get();
    const allBatches = new Set();
    studentsSnap.forEach(doc => {
      const b = doc.data().Batch || doc.data().batch;
      if (b) allBatches.add(b);
    });

    await step2UpdateConfig([...allBatches]);
    await step3FixKURLA();
    await step4GenerateFake();

    console.log('\n✅ All steps completed successfully!');
    process.exit(0);
  } catch (e) {
    console.error('❌ Error:', e);
    process.exit(1);
  }
})();
