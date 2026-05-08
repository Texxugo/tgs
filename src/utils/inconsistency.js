const { db } = require("../db/database");
const { getLatestTimeEntry } = require("./timeEntries");

const MAX_HOURS_MS = 12 * 60 * 60 * 1000;
const TOL_HOURS_MS = 13 * 60 * 60 * 1000;

async function ensureInconsistencyAlert(userId, nowIso) {
  const last = await getLatestTimeEntry(userId);

  if (!last || last.type !== "IN") return { inconsistent: false };

  const inTime = Date.parse(last.occurred_at);
  const nowTime = Date.parse(nowIso);
  if (!Number.isFinite(inTime) || !Number.isFinite(nowTime)) {
    return { inconsistent: false };
  }

  const elapsed = nowTime - inTime;
  if (elapsed < MAX_HOURS_MS) return { inconsistent: false };

  const severity = elapsed >= TOL_HOURS_MS ? 2 : 1;
  const elapsedHours = Math.round((elapsed / (60 * 60 * 1000)) * 10) / 10;
  const note = `JORNADA_INCONSISTENTE: IN aberto ha ~${elapsedHours}h (max=12h, tol=13h)`;

  const existingResult = await db.query(
    `
      SELECT id, severity
      FROM alerts
      WHERE type = 'JORNADA_INCONSISTENTE'
        AND user_id = $1
        AND time_in_entry_id = $2
        AND resolved_at IS NULL
      LIMIT 1
    `,
    [userId, last.id],
  );
  const existing = existingResult.rows[0];

  if (!existing) {
    const insertResult = await db.query(
      `
        INSERT INTO alerts (type, user_id, time_in_entry_id, severity, note)
        VALUES ('JORNADA_INCONSISTENTE', $1, $2, $3, $4)
        RETURNING id
      `,
      [userId, last.id, severity, note],
    );
    const alertId = insertResult.rows[0].id;

    return {
      inconsistent: true,
      created_alert: true,
      alert_id: Number(alertId),
      severity,
    };
  }

  if (Number(existing.severity) !== severity) {
    await db.query("UPDATE alerts SET severity = $1, note = $2 WHERE id = $3", [
      severity,
      note,
      existing.id,
    ]);
  }

  return {
    inconsistent: true,
    created_alert: false,
    alert_id: Number(existing.id),
    severity,
  };
}

module.exports = { ensureInconsistencyAlert };
