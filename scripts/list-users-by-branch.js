// List all students from Firestore, grouped by branch
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.local') });
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

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
    // Try both collections (prefixed and non-prefixed)
    const collections = ['students', 'dev_students'];

    for (const colName of collections) {
      const snap = await db.collection(colName).get();
      if (snap.empty) {
        console.log(`\n========== ${colName}: (empty or missing) ==========`);
        continue;
      }

      console.log(`\n========== ${colName.toUpperCase()} (${snap.size} docs) ==========`);

      // Group by branch
      const byBranch = {};
      snap.forEach(doc => {
        const d = doc.data();
        const branch = d.Branch || d.branch || '(no branch)';
        if (!byBranch[branch]) byBranch[branch] = [];
        byBranch[branch].push({
          id: doc.id,
          name:    d.Name    || d.name    || '',
          phone:   d.Phone   || d.phone   || '',
          course:  d.Course  || d.course  || '',
          batch:   d.Batch   || d.batch   || '',
          year:    d.Year    || d.year    || '',
          role:    d.Role    || d.role    || '',
          faculty: d.Faculty || d.faculty || ''
        });
      });

      // Sort branches
      const branches = Object.keys(byBranch).sort();
      console.log(`Branches found: ${branches.length}`);
      branches.forEach(b => console.log(`  - ${b} (${byBranch[b].length} users)`));

      // Write a text report file
      let report = `USERS BY BRANCH — ${colName}\nGenerated: ${new Date().toISOString()}\nTotal users: ${snap.size}\n\n`;

      branches.forEach(branch => {
        const users = byBranch[branch].sort((a, b) => a.name.localeCompare(b.name));
        report += `\n${'='.repeat(80)}\nBRANCH: ${branch}  (${users.length} users)\n${'='.repeat(80)}\n`;

        // Further group by role
        const byRole = {};
        users.forEach(u => {
          const r = u.role || '(no role)';
          if (!byRole[r]) byRole[r] = [];
          byRole[r].push(u);
        });

        Object.keys(byRole).sort().forEach(role => {
          report += `\n  --- ${role} (${byRole[role].length}) ---\n`;
          byRole[role].forEach((u, i) => {
            report += `  ${String(i + 1).padStart(3)}. ${u.name.padEnd(35)} | ${u.phone.padEnd(12)} | ${u.course.padEnd(10)} | ${u.batch.padEnd(20)} | Year: ${u.year}\n`;
          });
        });
      });

      const outPath = path.resolve(__dirname, `../users-by-branch_${colName}.txt`);
      fs.writeFileSync(outPath, report, 'utf-8');
      console.log(`\n✓ Report written to: ${outPath}`);

      // Also write CSV
      const csvPath = path.resolve(__dirname, `../users-by-branch_${colName}.csv`);
      const csvHeaders = 'Branch,Role,Name,Phone,Course,Batch,Year,Faculty\n';
      let csv = csvHeaders;
      branches.forEach(branch => {
        byBranch[branch].sort((a, b) => a.name.localeCompare(b.name)).forEach(u => {
          csv += `"${branch}","${u.role}","${u.name}","${u.phone}","${u.course}","${u.batch}","${u.year}","${u.faculty}"\n`;
        });
      });
      fs.writeFileSync(csvPath, csv, 'utf-8');
      console.log(`✓ CSV written to:    ${csvPath}`);
    }

    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
