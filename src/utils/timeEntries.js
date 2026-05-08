const { db } = require("../db/database");

async function getLatestTimeEntry(userId, queryable = db) {
  const result = await queryable.query(
    `
      SELECT id, user_id, type, occurred_at, latitude, longitude, location_address
      FROM times_entries
      WHERE user_id = $1
      ORDER BY occurred_at DESC, id DESC
      LIMIT 1
    `,
    [userId],
  );

  return result.rows[0] || null;
}

module.exports = { getLatestTimeEntry };
