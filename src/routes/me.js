const fs = require("fs");
const express = require("express");
const { z } = require("zod");
const { authRequired } = require("../middlewares/auth");
const { db } = require("../db/database");
const {
  inferRequestedType,
  parseSignatureBase64,
  resolveStoredPath,
  saveSignaturePng,
} = require("../utils/forgottenRequests");

const router = express.Router();

function two(value) {
  return String(value).padStart(2, "0");
}

function formatLegacyDateParts(date) {
  return {
    forgottenDate: `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`,
    hhmm: `${two(date.getHours())}:${two(date.getMinutes())}`,
  };
}

function mapMissedPunchRow(row) {
  const requestedType = inferRequestedType({
    requestedType: row.requested_type,
    entryTime: row.entry_time,
    exitTime: row.exit_time,
  });
  const requestedOccurredAt =
    row.requested_occurred_at ||
    (row.forgotten_date && (row.entry_time || row.exit_time)
      ? `${row.forgotten_date}T${String(row.entry_time || row.exit_time).slice(0, 5)}:00`
      : null);

  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    requested_type: requestedType,
    requested_occurred_at: requestedOccurredAt,
    note: row.note || row.reason || "",
    status: row.status,
    created_at: row.created_at,
    reviewed_at: row.reviewed_at,
    reviewed_by: row.reviewed_by,
    review_note: row.review_note,
  };
}

router.get("/", authRequired, async (req, res) => {
  const result = await db.query(
    "SELECT id, name, cpf, role, is_active, created_at FROM users WHERE id = $1",
    [req.user.id],
  );
  const user = result.rows[0];

  if (!user) return res.status(404).json({ error: "Usuario nao encontrado." });
  return res.json({ user });
});

router.get("/missed-punch-requests", authRequired, async (req, res) => {
  const result = await db.query(
    `
      SELECT
        id,
        user_id,
        requested_type,
        requested_occurred_at,
        note,
        forgotten_date,
        entry_time,
        exit_time,
        reason,
        status,
        created_at,
        reviewed_at,
        reviewed_by,
        review_note
      FROM missed_punch_requests
      WHERE user_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 10
    `,
    [req.user.id],
  );

  return res.json({ requests: result.rows.map(mapMissedPunchRow) });
});

router.post("/missed-punch-requests", authRequired, async (req, res) => {
  const schema = z
    .object({
      type: z.enum(["IN", "OUT"]),
      occurred_at: z.string().min(1),
      note: z.string().trim().min(3).max(500),
      signature_data_url: z
        .string()
        .startsWith("data:image/png;base64,")
        .max(2_000_000),
    })
    .strict();

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Dados invalidos", details: parsed.error.flatten() });
  }

  const occurredAt = new Date(parsed.data.occurred_at);
  if (Number.isNaN(occurredAt.getTime())) {
    return res.status(400).json({ error: "Data/hora invalida" });
  }

  let signaturePath;
  try {
    const { buffer } = parseSignatureBase64(parsed.data.signature_data_url);
    signaturePath = saveSignaturePng(req.user.id, buffer);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Assinatura invalida" });
  }

  const { forgottenDate, hhmm } = formatLegacyDateParts(occurredAt);
  const entryTime = parsed.data.type === "IN" ? hhmm : null;
  const exitTime = parsed.data.type === "OUT" ? hhmm : null;

  let insertResult;
  try {
    insertResult = await db.query(
      `
        INSERT INTO missed_punch_requests (
          user_id,
          requested_type,
          requested_occurred_at,
          note,
          employee_name,
          forgotten_date,
          entry_time,
          exit_time,
          reason,
          confirmed_by_employee,
          signature_path,
          signed_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
        RETURNING
          id,
          user_id,
          requested_type,
          requested_occurred_at,
          note,
          forgotten_date,
          entry_time,
          exit_time,
          reason,
          status,
          created_at,
          reviewed_at,
          reviewed_by,
          review_note
      `,
      [
        req.user.id,
        parsed.data.type,
        occurredAt.toISOString(),
        parsed.data.note,
        req.user.name,
        forgottenDate,
        entryTime,
        exitTime,
        parsed.data.note,
        true,
        signaturePath,
      ],
    );
  } catch {
    if (signaturePath) {
      try {
        fs.unlinkSync(resolveStoredPath(signaturePath));
      } catch {}
    }
    return res.status(500).json({ error: "Nao foi possivel salvar a solicitacao" });
  }

  return res.status(201).json({
    request: mapMissedPunchRow(insertResult.rows[0]),
    message: "Solicitacao de esquecimento registrada com assinatura.",
  });
});

module.exports = router;
