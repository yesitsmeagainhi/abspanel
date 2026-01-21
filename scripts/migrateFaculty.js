// scripts/migrateFaculty.js
// One-time script to migrate existing hardcoded faculty list to Firestore

require('dotenv').config();
const admin = require('firebase-admin');

// Initialize Firebase Admin
if (!admin.apps.length) {
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey
    })
  });
}

const db = admin.firestore();

// Original faculty list from lectures.html
const facultyList = [
  { name: "Ajay Kushwaha", department: "Pharmacy" },
  { name: "Ronak Mishra", department: "Pharmacy" },
  { name: "Amit Agrawal sir", department: "Pharmacy" },
  { name: "Ankit Khedekar Sir", department: "Pharmacy" },
  { name: "Deepika Gill mam", department: "Pharmacy" },
  { name: "Dr. Akash Sir", department: "Pharmacy" },
  { name: "Dr. Ruhi Solkar mam", department: "Pharmacy" },
  { name: "Dr. Snehal Chavhan mam", department: "Pharmacy" },
  { name: "Dr Utpala mam", department: "Pharmacy" },
  { name: "Jitesh Choudhary sir", department: "Pharmacy" },
  { name: "Kuldeep Prajapati sir", department: "Pharmacy" },
  { name: "Mr. Abhishek prajapati", department: "Pharmacy" },
  { name: "Naresh Basude", department: "Pharmacy" },
  { name: "Pooja Ghuge mam", department: "Nursing" },
  { name: "Priya mayur dighe mam", department: "Nursing" },
  { name: "Rachana Chauhan mam", department: "Nursing" },
  { name: "Rajesh Prajapat", department: "Pharmacy" },
  { name: "Rashmi Ghuge mam", department: "Nursing" },
  { name: "Ravishkumar Verma Sir", department: "Pharmacy" },
  { name: "Rubina Khan mam", department: "Nursing" },
  { name: "Shalaka Regan Fernandes mam", department: "Nursing" },
  { name: "Sharda Burande mam", department: "Nursing" },
  { name: "Shraddha Agrawal mam", department: "Pharmacy" },
  { name: "Sneha durge mam", department: "Nursing" },
  { name: "Srishti Rajesh Pohuja mam", department: "Nursing" },
  { name: "Suryansh Singh", department: "Pharmacy" },
  { name: "Zara Mam", department: "Nursing" },
  { name: "Poonam Yadav mam", department: "Nursing" }
];

async function migrateFaculty() {
  console.log('Starting faculty migration...');
  console.log(`Total faculty to migrate: ${facultyList.length}`);

  try {
    // Check if faculty collection already has data
    const existingSnap = await db.collection('faculty').limit(1).get();

    if (!existingSnap.empty) {
      console.log('\n⚠️  WARNING: Faculty collection already contains data.');
      console.log('This script will add new faculty members but won\'t remove existing ones.');
      console.log('If you want to start fresh, manually delete the faculty collection first.\n');
    }

    let added = 0;
    let skipped = 0;

    for (const faculty of facultyList) {
      // Check if faculty already exists (by name)
      const existingFaculty = await db.collection('faculty')
        .where('name', '==', faculty.name)
        .limit(1)
        .get();

      if (existingFaculty.empty) {
        // Add new faculty member
        await db.collection('faculty').add({
          name: faculty.name,
          department: faculty.department,
          email: '',
          phone: '',
          specialization: '',
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`✅ Added: ${faculty.name}`);
        added++;
      } else {
        console.log(`⏭️  Skipped (already exists): ${faculty.name}`);
        skipped++;
      }
    }

    console.log('\n─────────────────────────────────');
    console.log('Migration Summary:');
    console.log(`✅ Added: ${added}`);
    console.log(`⏭️  Skipped: ${skipped}`);
    console.log(`📊 Total: ${facultyList.length}`);
    console.log('─────────────────────────────────\n');
    console.log('Migration completed successfully!');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error during migration:', error);
    process.exit(1);
  }
}

// Run migration
migrateFaculty();
