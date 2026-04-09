// Regenerate fake attendance with phone numbers as doc IDs.
//
// What this does:
//  1. PEEK: Show real (phone-ID) vs fake (Firestore-ID) doc structure.
//  2. DELETE: Remove all attendance docs in non-Nalasopara branches whose
//     doc ID is NOT a phone number (i.e., the fake ones I previously created
//     using Firestore auto-generated student doc IDs).
//     Nalasopara real data and any phone-ID docs are left untouched.
//  3. REGENERATE: For each non-Nalasopara student in `students` collection,
//     create/merge an attendance doc at studentattendance/<phone> with 100%
//     attendance for April 1-9, 2026. This matches the real data format so
//     when real attendance flows in, it merges into the same document.
//
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
const NON_NALASOPARA = TARGET_BRANCHES.filter(b => b !== 'Nalasopara');

const FAKE_MONTH = '2026-04';
const FAKE_DAYS_FROM = 1;
const FAKE_DAYS_TO = 9;
const ATTENDANCE_RATE = 1.0; // 100% present

// A "phone-like" doc ID = 10-15 digits. Anything else is treated as a fake/legacy doc.
function isPhoneLikeId(id) {
  return /^\d{10,15}$/.test(id);
}

// Normalize phone: keep only digits, strip leading +91/91/0
function normalizePhone(raw) {
  if (!raw) return '';
  let s = String(raw).replace(/\D/g, '');
  if (s.length === 12 && s.startsWith('91')) s = s.slice(2);
  if (s.length === 11 && s.startsWith('0'))  s = s.slice(1);
  return s;
}

function getDates() {
  const out = [];
  for (let d = FAKE_DAYS_FROM; d <= FAKE_DAYS_TO; d++) {
    out.push(`${FAKE_MONTH}-${String(d).padStart(2, '0')}`);
  }
  return out;
}

function makeFakeDayData(dateStr) {
  if (Math.random() > ATTENDANCE_RATE) return null;
  const baseDate = new Date(dateStr + 'T00:00:00+05:30');

  const inHour = 8 + Math.floor(Math.random() * 2);   // 8 or 9
  const inMin  = Math.floor(Math.random() * 60);
  const inDate = new Date(baseDate);
  inDate.setHours(inHour, inMin, 0, 0);

  const outHour = 16 + Math.floor(Math.random() * 3); // 16/17/18
  const outMin  = Math.floor(Math.random() * 60);
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
  console.log('\n=== STEP 1: Peek existing studentattendance docs ===');
  const snap = await db.collection('studentattendance').limit(500).get();
  let phoneIdCount = 0;
  let nonPhoneIdCount = 0;
  const byBranchPhone = {};
  const byBranchFake  = {};

  snap.forEach(d => {
    const data = d.data() || {};
    const branch = (data.meta && data.meta.branch) || '(no branch)';
    if (isPhoneLikeId(d.id)) {
      phoneIdCount++;
      byBranchPhone[branch] = (byBranchPhone[branch] || 0) + 1;
    } else {
      nonPhoneIdCount++;
      byBranchFake[branch] = (byBranchFake[branch] || 0) + 1;
    }
  });

  console.log(`(sampled up to 500 docs)`);
  console.log(`  phone-ID docs  : ${phoneIdCount}`);
  Object.keys(byBranchPhone).sort().forEach(b => console.log(`      ${b}: ${byBranchPhone[b]}`));
  console.log(`  non-phone docs : ${nonPhoneIdCount}`);
  Object.keys(byBranchFake).sort().forEach(b => console.log(`      ${b}: ${byBranchFake[b]}`));
}

async function step2DeleteFakeDocs() {
  console.log('\n=== STEP 2: Delete non-phone-ID docs in non-Nalasopara branches ===');

  // Need to scan entire studentattendance collection since branches are in meta.
  // We keep:
  //   - any doc in Nalasopara
  //   - any phone-ID doc (real data), regardless of branch
  // We delete:
  //   - non-phone-ID docs whose meta.branch is in NON_NALASOPARA
  //   - non-phone-ID docs with (no branch) that look fake (paranoid: skip)
  const snap = await db.collection('studentattendance').get();
  console.log(`Total attendance docs scanned: ${snap.size}`);

  const toDelete = [];
  snap.forEach(d => {
    const data = d.data() || {};
    const branch = data.meta && data.meta.branch;
    if (isPhoneLikeId(d.id)) return;                  // keep real
    if (branch === 'Nalasopara') return;              // keep nalasopara (shouldn't exist non-phone, but safe)
    if (!NON_NALASOPARA.includes(branch)) return;     // skip unknowns for safety
    toDelete.push(d.ref);
  });

  console.log(`Docs to delete: ${toDelete.length}`);
  if (toDelete.length === 0) return;

  let batch = db.batch();
  let n = 0;
  let total = 0;
  for (const ref of toDelete) {
    batch.delete(ref);
    n++;
    total++;
    if (n >= 400) {
      await batch.commit();
      console.log(`  Deleted batch of ${n}  (running total: ${total})`);
      batch = db.batch();
      n = 0;
    }
  }
  if (n > 0) {
    await batch.commit();
    console.log(`  Deleted batch of ${n}  (running total: ${total})`);
  }
  console.log(`✓ Deleted ${total} fake docs`);
}

async function step3RegenerateWithPhoneIds() {
  console.log('\n=== STEP 3: Regenerate fake attendance with phone-number doc IDs ===');

  const snap = await db.collection('students').get();
  console.log(`Total students: ${snap.size}`);

  const targets = [];
  const skippedNoPhone = [];
  const skippedOtherBranch = [];
  const phoneToStudents = {}; // phone -> array of students (to detect dupes)

  snap.forEach(doc => {
    const d = doc.data() || {};
    const branch = d.Branch || d.branch;
    if (!NON_NALASOPARA.includes(branch)) {
      skippedOtherBranch.push({ id: doc.id, branch });
      return;
    }
    const rawPhone = d.number || d.Number || d.Phone || d.phone || d.mobile || '';
    const phone = normalizePhone(rawPhone);
    if (!phone) {
      skippedNoPhone.push({
        id: doc.id,
        name: d.Name || d.name || '',
        branch
      });
      return;
    }
    if (!phoneToStudents[phone]) phoneToStudents[phone] = [];
    phoneToStudents[phone].push({
      id: doc.id,
      name:   d.Name   || d.name   || 'Unknown',
      branch,
      batch:  d.Batch  || d.batch  || 'F- Batch D.Pharm',
      course: d.Course || d.course || '',
      phone
    });
    targets.push({
      id: doc.id,
      name:   d.Name   || d.name   || 'Unknown',
      branch,
      batch:  d.Batch  || d.batch  || 'F- Batch D.Pharm',
      course: d.Course || d.course || '',
      phone
    });
  });

  // Dedupe by phone — keep the FIRST student per phone.
  const seen = new Set();
  const unique = [];
  const dupes = [];
  for (const t of targets) {
    if (seen.has(t.phone)) {
      dupes.push(t);
    } else {
      seen.add(t.phone);
      unique.push(t);
    }
  }

  console.log(`Non-Nalasopara students                    : ${targets.length + skippedNoPhone.length}`);
  console.log(`  with valid phone                         : ${targets.length}`);
  console.log(`  skipped (no phone)                       : ${skippedNoPhone.length}`);
  console.log(`  after dedupe by phone                    : ${unique.length}`);
  console.log(`  duplicates dropped                       : ${dupes.length}`);
  console.log(`Skipped (other/unknown branch)             : ${skippedOtherBranch.length}`);

  // Per-branch breakdown of what we'll write
  const byBranch = {};
  unique.forEach(s => { byBranch[s.branch] = (byBranch[s.branch] || 0) + 1; });
  console.log('\nWill write attendance for:');
  Object.keys(byBranch).sort().forEach(b => console.log(`  ${b}: ${byBranch[b]}`));

  if (skippedNoPhone.length > 0) {
    console.log('\nFirst 10 students skipped due to missing phone:');
    skippedNoPhone.slice(0, 10).forEach(s =>
      console.log(`  - ${s.name.padEnd(35)} | ${s.branch} | ${s.id}`)
    );
  }

  const dates = getDates();
  console.log(`\nDate range: ${dates[0]} to ${dates[dates.length - 1]}  (${dates.length} days, ${ATTENDANCE_RATE * 100}% present)\n`);

  let writeBatch = db.batch();
  let n = 0;
  let total = 0;

  for (const s of unique) {
    const days = {};
    for (const date of dates) {
      const dayData = makeFakeDayData(date);
      if (dayData) days[date] = dayData;
    }

    const attRef = db.collection('studentattendance').doc(s.phone);
    writeBatch.set(attRef, {
      meta: {
        name:   s.name,
        branch: s.branch,
        batch:  s.batch,
        course: s.course,
        phone:  s.phone
      },
      days
    }, { merge: true });

    n++;
    total++;
    if (n >= 400) {
      await writeBatch.commit();
      console.log(`  Committed ${n} writes  (running total: ${total})`);
      writeBatch = db.batch();
      n = 0;
    }
  }
  if (n > 0) {
    await writeBatch.commit();
    console.log(`  Committed ${n} writes  (running total: ${total})`);
  }

  console.log(`\n✓ Wrote fake attendance for ${total} students (phone-number doc IDs)`);
}

async function step4VerifyNalasopara() {
  console.log('\n=== STEP 4: Verify Nalasopara real data untouched ===');
  const snap = await db.collection('studentattendance').limit(1000).get();
  let nalaCount = 0;
  let nalaPhoneId = 0;
  snap.forEach(d => {
    const data = d.data() || {};
    if (data.meta && data.meta.branch === 'Nalasopara') {
      nalaCount++;
      if (isPhoneLikeId(d.id)) nalaPhoneId++;
    }
  });
  console.log(`Nalasopara docs (in first 1000 scanned): ${nalaCount}`);
  console.log(`  with phone-ID                         : ${nalaPhoneId}`);
}

(async () => {
  try {
    await step1Peek();
    await step2DeleteFakeDocs();
    await step3RegenerateWithPhoneIds();
    await step4VerifyNalasopara();

    console.log('\n✅ All steps completed. Fake attendance now uses phone-number doc IDs.');
    console.log('   Future real attendance from students will merge into the same docs.');
    process.exit(0);
  } catch (e) {
    console.error('❌ Error:', e);
    process.exit(1);
  }
})();
