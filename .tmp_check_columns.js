const { db } = require('./src/db/database');

(async () => {
  try {
    const result = await db.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'missed_punch_requests' ORDER BY ordinal_position");
    console.log(JSON.stringify(result.rows, null, 2));
  } catch (error) {
    console.error('ERR:', error && error.message ? error.message : error);
  } finally {
    process.exit(0);
  }
})();
