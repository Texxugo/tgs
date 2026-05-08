const fs = require("fs");
const express = require("express");
const { z } = require("zod");
const { db } = require("../db/database");
const { authRequired } = require("../middlewares/auth");
const { ensureInconsistencyAlert } = require("../utils/inconsistency");
const {
  buildForgottenOccurredAt,
  inferRequestedType,
  parseSignatureBase64,
  resolveStoredPath,
  saveSignaturePng,
} = require("../utils/forgottenRequests");
const {
  resolveSingleActiveServiceOrderId,
  assertUserCanUseServiceOrder,
} = require("../utils/activeServiceOrder");
const { getLatestTimeEntry } = require("../utils/timeEntries");

const router = express.Router();

function normalizeOptionalText(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function isValidDateOnly(dateText) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return false;

  const [year, month, day] = dateText.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

router.post("/clock", authRequired, async (req, res) => {
  const schema = z.object({
    type: z.enum(["IN", "OUT"]),
    occurred_at: z.string().min(1),
    latitude: z.number().nullable().optional(),
    longitude: z.number().nullable().optional(),
    address: z.string().trim().max(1000).nullable().optional(),
    service_order_id: z.number().int().positive().nullable().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Dados invalidos", details: parsed.error.flatten() });
  }

  const {
    type,
    occurred_at,
    latitude = null,
    longitude = null,
    address = null,
    service_order_id = null,
  } = parsed.data;

  const userId = req.user.id;
  const nowIso = new Date().toISOString();
  let soId = service_order_id;

  if (soId === null || soId === undefined) {
    soId = await resolveSingleActiveServiceOrderId(userId, nowIso);
  }

  if (soId != null) {
    const ok = await assertUserCanUseServiceOrder(userId, soId);
    if (!ok) {
      return res.status(403).json({ error: "OS invalida ou nao atribuida ao usuario" });
    }
  }

  const inconsistency = await ensureInconsistencyAlert(userId, nowIso);

  const last = await getLatestTimeEntry(userId);
  const isInJourney = !!last && last.type === "IN";

  if (type === "IN" && isInJourney) {
    return res.status(409).json({ error: "Usuario ja esta em jornada" });
  }
  if (type === "OUT" && !isInJourney) {
    return res.status(409).json({ error: "Usuario nao esta em jornada" });
  }

  const insertResult = await db.query(
    `
      INSERT INTO times_entries
      (user_id, type, occurred_at, latitude, longitude, location_address, service_order_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `,
    [userId, type, occurred_at, latitude, longitude, normalizeOptionalText(address), soId ?? null],
  );

  return res.status(201).json({
    id: Number(insertResult.rows[0].id),
    user_id: userId,
    type,
    occurred_at,
    latitude,
    longitude,
    address: normalizeOptionalText(address),
    location_address: normalizeOptionalText(address),
    service_order_id: soId ?? null,
    inconsistency: inconsistency.inconsistent ? inconsistency : null,
  });
});

router.post("/forgotten", authRequired, async (req, res) => {
  const schema = z
    .object({
      employee_name: z.string().trim().min(1).max(200),
      forgotten_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      entry_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      exit_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      reason: z.string().trim().min(1).max(1000),
      workplace: z.string().trim().max(200).optional(),
      notes: z.string().trim().max(1000).optional(),
      confirmed_by_employee: z.boolean(),
      signature_base64: z.string().min(1).max(2_500_000),
      signed_at: z.string().min(1),
    })
    .strict();

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Dados invalidos", details: parsed.error.flatten() });
  }

  const payload = parsed.data;
  if (!payload.entry_time && !payload.exit_time) {
    return res.status(400).json({ error: "Informe pelo menos entry_time ou exit_time" });
  }
  if (!isValidDateOnly(payload.forgotten_date)) {
    return res.status(400).json({ error: "forgotten_date invalida" });
  }

  const signedAt = new Date(payload.signed_at);
  if (Number.isNaN(signedAt.getTime())) {
    return res.status(400).json({ error: "signed_at invalido" });
  }

  let signaturePath;
  try {
    const { buffer } = parseSignatureBase64(payload.signature_base64);
    signaturePath = saveSignaturePng(req.user.id, buffer);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Assinatura invalida" });
  }

  try {
    const requestedType = inferRequestedType({
      entryTime: payload.entry_time,
      exitTime: payload.exit_time,
    });
    const requestedOccurredAt = buildForgottenOccurredAt(
      payload.forgotten_date,
      payload.entry_time || payload.exit_time,
    );

    await db.query(
      `
        INSERT INTO missed_punch_requests (
          user_id,
          employee_name,
          forgotten_date,
          entry_time,
          exit_time,
          reason,
          workplace,
          notes,
          confirmed_by_employee,
          signature_path,
          signed_at,
          requested_type,
          requested_occurred_at,
          note
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
        )
      `,
      [
        req.user.id,
        payload.employee_name,
        payload.forgotten_date,
        payload.entry_time || null,
        payload.exit_time || null,
        payload.reason,
        normalizeOptionalText(payload.workplace),
        normalizeOptionalText(payload.notes),
        payload.confirmed_by_employee,
        signaturePath,
        signedAt.toISOString(),
        requestedType,
        requestedOccurredAt,
        payload.reason,
      ],
    );
  } catch (error) {
    if (signaturePath) {
      try {
        fs.unlinkSync(resolveStoredPath(signaturePath));
      } catch {}
    }
    return res.status(500).json({ error: "Nao foi possivel salvar a solicitacao" });
  }

  return res.status(201).json({
    success: true,
    message: "Solicitação recebida com sucesso",
  });
});

router.get("/status", authRequired, async (req, res) => {
  const userId = req.user.id;
  const nowIso = new Date().toISOString();
  const inconsistency = await ensureInconsistencyAlert(userId, nowIso);

  const last = await getLatestTimeEntry(userId);
  const isInJourney = !!last && last.type === "IN";

  return res.json({
    in_journey: isInJourney,
    last,
    inconsistency: inconsistency.inconsistent ? inconsistency : null,
  });
});

module.exports = router;
