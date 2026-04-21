// server/attendanceListener.js
// Watches Firestore `studentattendance` collection for punch IN/OUT changes,
// then sends WhatsApp notifications via whatsapp.js.

const { sendWhatsApp } = require('./whatsapp');

// Track last known state per student to detect IN/OUT transitions
const lastKnownState = new Map();

/**
 * Get today's date key in IST (matches mobile app's todayKey()).
 */
function getTodayKeyIST() {
  const now = new Date();
  const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const d = String(ist.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Format a timestamp or millisecond number to IST time string.
 */
function formatTimeIST(timestamp) {
  if (!timestamp) return 'N/A';
  const date =
    typeof timestamp.toDate === 'function'
      ? timestamp.toDate()
      : new Date(timestamp);
  return date.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Format duration in minutes to human-readable string.
 */
function formatDuration(minutes) {
  if (!minutes || minutes <= 0) return '0 min';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m} min`;
}

/**
 * Pick a random element from an array.
 */
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Message variation pools to avoid identical messages
const GREETINGS = ['Hello', 'Hi', 'Hey', 'Dear'];
const IN_LINES = [
  'Your attendance has been marked.',
  'You have been signed in successfully.',
  'Your sign-in has been recorded.',
  'Attendance recorded for today.',
];
const IN_CLOSINGS = [
  'Have a productive session!',
  'Wishing you a great study session!',
  'All the best for today!',
  'Make the most of your time!',
];
const OUT_LINES = [
  'Your session has ended.',
  'You have been signed out.',
  'Your sign-out has been recorded.',
  'Session completed for today.',
];
const OUT_CLOSINGS = [
  'Great effort! See you next time.',
  'Well done! Keep it up.',
  'Good job today! See you soon.',
  'Keep up the good work!',
];

/**
 * Build the WhatsApp message text with randomized greetings/closings.
 */
function formatMessage(punchType, studentName, branchName, dateKey, dayData) {
  const greeting = pick(GREETINGS);

  if (punchType === 'IN') {
    const time = formatTimeIST(dayData.inAt || dayData.inAtMs);
    return [
      `${greeting} ${studentName},`,
      ``,
      pick(IN_LINES),
      `Date: ${dateKey}`,
      `Sign In: ${time}`,
      `Branch: ${branchName}`,
      ``,
      pick(IN_CLOSINGS),
      `- ABS Education`,
    ].join('\n');
  }

  if (punchType === 'OUT') {
    const inTime = formatTimeIST(dayData.inAt || dayData.inAtMs);
    const outTime = formatTimeIST(dayData.outAt || dayData.outAtMs);
    const duration = formatDuration(dayData.durationMin);
    return [
      `${greeting} ${studentName},`,
      ``,
      pick(OUT_LINES),
      `Date: ${dateKey}`,
      `Sign In: ${inTime}`,
      `Sign Out: ${outTime}`,
      `Duration: ${duration}`,
      `Branch: ${branchName}`,
      ``,
      pick(OUT_CLOSINGS),
      `- ABS Education`,
    ].join('\n');
  }

  return '';
}

/**
 * Start listening to the studentattendance collection.
 * @param {FirebaseFirestore.Firestore} db - Admin Firestore instance
 */
/**
 * Read a day's attendance data from the document.
 * Handles BOTH storage formats used by the mobile app:
 *   - Flat keys: data['days.2026-04-15.hasIn'] (from setDoc with merge)
 *   - Nested:    data.days['2026-04-15'].hasIn  (from updateDoc)
 */
function readDayFromDoc(data, dk) {
  // Flat keys (setDoc with merge stores dots as literal top-level keys)
  const flatHasIn   = data?.[`days.${dk}.hasIn`];
  const flatHasOut  = data?.[`days.${dk}.hasOut`];
  const flatInAt    = data?.[`days.${dk}.inAt`];
  const flatOutAt   = data?.[`days.${dk}.outAt`];
  const flatInAtMs  = data?.[`days.${dk}.inAtMs`];
  const flatOutAtMs = data?.[`days.${dk}.outAtMs`];
  const flatDuration = data?.[`days.${dk}.durationMin`];

  // Nested keys (updateDoc creates nested paths)
  const nested = data?.days?.[dk] || {};

  return {
    hasIn:       !!(flatHasIn  ?? nested.hasIn),
    hasOut:      !!(flatHasOut ?? nested.hasOut),
    inAt:        flatInAt   ?? nested.inAt ?? null,
    outAt:       flatOutAt  ?? nested.outAt ?? null,
    inAtMs:      flatInAtMs ?? nested.inAtMs ?? null,
    outAtMs:     flatOutAtMs ?? nested.outAtMs ?? null,
    durationMin: flatDuration ?? nested.durationMin ?? 0,
  };
}

function startAttendanceListener(db) {
  const dk = getTodayKeyIST();

  console.log(`👁️  Watching studentattendance for date: ${dk}`);

  // Listen to all docs in the collection
  db.collection('studentattendance').onSnapshot(
    (snapshot) => {
      const changes = snapshot.docChanges();
      console.log(`[Listener] Snapshot received: ${changes.length} change(s)`);

      changes.forEach((change) => {
        if (change.type === 'removed') return;

        const studentNumber = change.doc.id;
        const data = change.doc.data();

        // Read day using BOTH flat keys and nested keys
        const dayData = readDayFromDoc(data, dk);

        console.log(`[Listener] Doc changed: ${studentNumber} | type: ${change.type} | hasIn=${dayData.hasIn} hasOut=${dayData.hasOut}`);

        // Skip if no attendance data for today
        if (!dayData.hasIn && !dayData.hasOut) {
          // Check if this is the initial snapshot load — store state and skip
          const stateKey = `${studentNumber}:${dk}`;
          lastKnownState.set(stateKey, { hasIn: false, hasOut: false });
          return;
        }

        // Build current state key
        const stateKey = `${studentNumber}:${dk}`;
        const prev = lastKnownState.get(stateKey) || { hasIn: false, hasOut: false };
        const curr = { hasIn: dayData.hasIn, hasOut: dayData.hasOut };

        console.log(`[Listener] ${studentNumber} | prev: IN=${prev.hasIn} OUT=${prev.hasOut} | curr: IN=${curr.hasIn} OUT=${curr.hasOut}`);

        // Detect transitions
        let punchType = null;
        if (!prev.hasIn && curr.hasIn) {
          punchType = 'IN';
        } else if (prev.hasIn && !prev.hasOut && curr.hasOut) {
          punchType = 'OUT';
        }

        // Update state
        lastKnownState.set(stateKey, curr);

        if (!punchType) {
          console.log(`[Listener] ${studentNumber} | No transition detected, skipping`);
          return;
        }

        console.log(`[Listener] ${studentNumber} | Detected: ${punchType} — sending WhatsApp...`);

        // Build and send message
        const studentName = data.name || studentNumber;
        const branchName = data.meta?.branch || 'Campus';
        const message = formatMessage(punchType, studentName, branchName, dk, dayData);

        // Send asynchronously — don't block the listener
        sendWhatsApp(studentNumber, message).catch((err) => {
          console.error(`Failed to send ${punchType} WhatsApp to ${studentNumber}:`, err.message);
        });
      });
    },
    (err) => {
      console.error('Attendance listener error:', err);
      // Re-attach listener after 30 seconds
      setTimeout(() => startAttendanceListener(db), 30000);
    }
  );

  // Reset date key at midnight IST
  scheduleReset(db);
}

/**
 * Schedule a daily reset at midnight IST to update the date key
 * and clear the in-memory state.
 */
function scheduleReset(db) {
  const now = new Date();
  const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  // Next midnight IST
  const nextMidnight = new Date(ist);
  nextMidnight.setUTCHours(0, 0, 0, 0);
  nextMidnight.setUTCDate(nextMidnight.getUTCDate() + 1);
  const msUntilMidnight = nextMidnight.getTime() - istMs;

  setTimeout(() => {
    console.log('🔄 Midnight IST — resetting attendance listener for new day');
    lastKnownState.clear();
    // Restart listener with new date key
    startAttendanceListener(db);
  }, msUntilMidnight);
}

module.exports = { startAttendanceListener };
