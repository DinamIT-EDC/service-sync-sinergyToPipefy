// src/runDailySync.js
const { extractActiveCards } = require('./extractActiveCards');
const { syncExistingCards } = require('./syncExistingCards');
const { syncNewEmployees } = require('./syncNewEmployees');

(async () => {
  try {
    console.log('🚀 Starting daily Pipefy ↔ Sinergy sync routine...');

    console.log('\n=== [1/3] Extracting ACTIVE cards from Pipefy ===');
    await extractActiveCards();

    console.log('\n=== [2/3] Syncing existing cards with Sinergy ===');
    await syncExistingCards();

    console.log('\n=== [3/3] Creating cards for new active Sinergy employees ===');
    await syncNewEmployees();

    console.log('\n✅ Daily sync routine finished successfully.');
  } catch (err) {
    console.error('\n💥 Fatal error in daily sync routine:', err.message);
    process.exit(1);
  }
})();
