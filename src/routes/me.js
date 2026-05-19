const fs = require("fs");
const express = require("express");
const { z } = require("zod");
const { authRequired } = require("../middlewares/auth");
const { db } = require("../db/database");
const {
  extractClientIp,
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

function extractLocalDateTimeParts(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (match) {
    return {
      forgottenDate: match[1],
      hhmm: match[2],
    };
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatLegacyDateParts(parsed);
}

function normalizeOptionalText(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
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
    client_timestamp: row.client_timestamp,
    client_timestamp_label: row.client_timestamp_label,
    client_timezone: row.client_timezone,
    client_timezone_offset_minutes: row.client_timezone_offset_minutes,
    client_latitude: row.client_latitude,
    client_longitude: row.client_longitude,
    client_ip: row.client_ip,
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
        client_timestamp,
        client_timestamp_label,
        client_timezone,
        client_timezone_offset_minutes,
        client_latitude,
        client_longitude,
        client_ip,
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
      client_timestamp: z.string().trim().min(1).max(80).optional(),
      client_timestamp_label: z.string().trim().min(1).max(200).optional(),
      client_timezone: z.string().trim().min(1).max(120).optional(),
      client_timezone_offset_minutes: z.number().int().min(-840).max(840).optional(),
      latitude: z.number().min(-90).max(90).nullable().optional(),
      longitude: z.number().min(-180).max(180).nullable().optional(),
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

  let clientTimestamp = new Date();
  if (parsed.data.client_timestamp) {
    clientTimestamp = new Date(parsed.data.client_timestamp);
    if (Number.isNaN(clientTimestamp.getTime())) {
      return res.status(400).json({ error: "client_timestamp invalido" });
    }
  }

  let signaturePath;
  try {
    const { buffer } = parseSignatureBase64(parsed.data.signature_data_url);
    signaturePath = saveSignaturePng(req.user.id, buffer);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Assinatura invalida" });
  }

  const localDateTimeParts = extractLocalDateTimeParts(parsed.data.occurred_at);
  if (!localDateTimeParts) {
    return res.status(400).json({ error: "Nao foi possivel interpretar occurred_at" });
  }

  const { forgottenDate, hhmm } = localDateTimeParts;
  const entryTime = parsed.data.type === "IN" ? hhmm : null;
  const exitTime = parsed.data.type === "OUT" ? hhmm : null;
  const clientIp = extractClientIp(req);

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
          signed_at,
          client_timestamp,
          client_timestamp_label,
          client_timezone,
          client_timezone_offset_minutes,
          client_latitude,
          client_longitude,
          client_ip
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
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
          client_timestamp,
          client_timestamp_label,
          client_timezone,
          client_timezone_offset_minutes,
          client_latitude,
          client_longitude,
          client_ip,
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
        clientTimestamp.toISOString(),
        clientTimestamp.toISOString(),
        normalizeOptionalText(parsed.data.client_timestamp_label),
        normalizeOptionalText(parsed.data.client_timezone),
        parsed.data.client_timezone_offset_minutes ?? null,
        parsed.data.latitude ?? null,
        parsed.data.longitude ?? null,
        clientIp,
      ],
    );
  } catch (error) {
    console.error("[me-forgotten-save-error]", error);
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

