const express = require("express");
const { z } = require("zod");
const { db } = require("../db/database");
const { authRequired } = require("../middlewares/auth");
const { requireRole } = require("../middlewares/requireRole");
const { getLatestTimeEntry } = require("../utils/timeEntries");

const router = express.Router();

router.post(
  "/users/:id/close-journey",
  authRequired,
  requireRole("ADMIN"),
  async (req, res) => {
    const userId = Number(req.params.id);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(400).json({ error: "ID invalido" });
    }

    const schema = z.object({
      occurred_at: z.string().min(1).optional(),
      latitude: z.number().nullable().optional(),
      longitude: z.number().nullable().optional(),
      alert_id: z.number().int().positive(),
      resolution_note: z.string().min(3).max(500),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Dados invalidos", details: parsed.error.flatten() });
    }

    const { latitude = null, longitude = null, alert_id, resolution_note } = parsed.data;
    const occurred_at = parsed.data.occurred_at || new Date().toISOString();

    const userResult = await db.query("SELECT id FROM users WHERE id = $1", [userId]);
    if (!userResult.rows[0]) {
      return res.status(404).json({ error: "Usuario nao encontrado" });
    }

    const alertResult = await db.query(
      `
        SELECT id, user_id, type, time_in_entry_id, resolved_at
        FROM alerts
        WHERE id = $1
      `,
      [alert_id],
    );
    const alert = alertResult.rows[0];

    if (!alert) return res.status(404).json({ error: "Alerta nao encontrado" });
    if (alert.resolved_at) return res.status(409).json({ error: "Alerta ja resolvido" });
    if (Number(alert.user_id) !== userId) {
      return res.status(400).json({ error: "Alerta nao pertence ao usuario" });
    }
    if (alert.type !== "JORNADA_INCONSISTENTE") {
      return res.status(400).json({ error: "Tipo de alerta invalido" });
    }

    const last = await getLatestTimeEntry(userId);

    if (!last || last.type !== "IN") {
      return res.status(409).json({ error: "Nao ha jornada aberta (ultimo registro nao e IN)" });
    }
    if (alert.time_in_entry_id && Number(alert.time_in_entry_id) !== Number(last.id)) {
      return res.status(409).json({
        error: "A jornada aberta atual nao corresponde ao alerta",
      });
    }

    const result = await db.withTransaction(async (tx) => {
      const note = "ADMIN_ADJUST_CLOSE_JOURNEY";

      const insertOutResult = await tx.query(
        `
          INSERT INTO times_entries
          (user_id, type, occurred_at, latitude, longitude, note, adjusted_by, adjusted_at, adjustment_note, source_alert_id)
          VALUES
          ($1, 'OUT', $2, $3, $4, $5, $6, NOW(), $7, $8)
          RETURNING id
        `,
        [userId, occurred_at, latitude, longitude, note, req.user.id, resolution_note, alert_id],
      );
      const outId = insertOutResult.rows[0].id;

      await tx.query(
        "UPDATE alerts SET resolved_at = NOW(), resolved_by = $1, resolution_note = $2 WHERE id = $3",
        [req.user.id, resolution_note, alert_id],
      );

      const createdOutResult = await tx.query(
        `
          SELECT id, user_id, type, occurred_at, latitude, longitude, note,
                 adjusted_by, adjusted_at, adjustment_note, source_alert_id
          FROM times_entries WHERE id = $1
        `,
        [outId],
      );

      const updatedAlertResult = await tx.query(
        `
          SELECT id, type, user_id, time_in_entry_id, severity, note,
                 created_at, resolved_at, resolved_by, resolution_note
          FROM alerts WHERE id = $1
        `,
        [alert_id],
      );

      return {
        createdOut: createdOutResult.rows[0],
        updatedAlert: updatedAlertResult.rows[0],
      };
    });

    return res.status(201).json(result);
  },
);

module.exports = router;
