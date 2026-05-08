const fs = require("fs");
const express = require("express");
const { z } = require("zod");
const { db } = require("../db/database");
const { authRequired } = require("../middlewares/auth");
const { requireRole } = require("../middlewares/requireRole");
const {
  buildForgottenOccurredAt,
  readSignatureAsDataUrl,
  resolveStoredPath,
} = require("../utils/forgottenRequests");
const {
  forgottenApprovalIntegrityExists,
  forgottenApprovalPdfExists,
  generateForgottenApprovalPdf,
  readForgottenApprovalIntegrity,
  resolveForgottenApprovalPdfPath,
} = require("../utils/forgottenRequestPdf");

const router = express.Router();

function normalizeStatus(status) {
  if (!status) return null;
  const normalized = String(status).trim().toUpperCase();
  if (["PENDING", "APPROVED", "REJECTED"].includes(normalized)) {
    return normalized;
  }
  return null;
}

function normalizeRequestRow(row, { includeSignature = false, includeIntegrity = false } = {}) {
  if (!row) return null;

  const hasPdf = row.status === "APPROVED" && forgottenApprovalPdfExists(row.id);
  const hasIntegrity = row.status === "APPROVED" && forgottenApprovalIntegrityExists(row.id);
  const integrity = includeIntegrity && hasIntegrity
    ? readForgottenApprovalIntegrity(row.id)
    : null;

  const normalized = {
    id: Number(row.id),
    user_id: Number(row.user_id),
    employee_name: row.employee_name,
    forgotten_date: row.forgotten_date,
    entry_time: row.entry_time ? String(row.entry_time).slice(0, 5) : null,
    exit_time: row.exit_time ? String(row.exit_time).slice(0, 5) : null,
    reason: row.reason,
    workplace: row.workplace,
    notes: row.notes,
    confirmed_by_employee: row.confirmed_by_employee,
    signed_at: row.signed_at,
    client_timestamp: row.client_timestamp,
    client_timestamp_label: row.client_timestamp_label,
    client_timezone: row.client_timezone,
    client_timezone_offset_minutes: row.client_timezone_offset_minutes,
    client_latitude: row.client_latitude,
    client_longitude: row.client_longitude,
    client_ip: row.client_ip,
    status: row.status,
    review_note: row.review_note,
    review_notes: row.review_note,
    reviewed_at: row.reviewed_at,
    reviewed_by: row.reviewed_by,
    created_at: row.created_at,
    updated_at: row.reviewed_at || row.created_at,
    user_name: row.user_name || null,
    user_cpf: row.user_cpf || null,
    reviewed_by_name: row.reviewed_by_name || null,
    signature_available: !!row.signature_path,
    approval_pdf_available: hasPdf,
    approval_pdf_url:
      hasPdf
        ? `/admin/forgotten-requests/${row.id}/pdf`
        : null,
    integrity_available: hasIntegrity,
    integrity_hash: integrity ? integrity.payload_sha256 : null,
    integrity_algorithm: integrity ? integrity.algorithm : null,
    integrity_pdf_hash: integrity ? integrity.pdf_sha256 : null,
    integrity_url:
      hasIntegrity
        ? `/admin/forgotten-requests/${row.id}/integrity`
        : null,
  };

  if (includeSignature) {
    normalized.signature_data_url = row.signature_path
      ? readSignatureAsDataUrl(row.signature_path)
      : row.signature_data_url || null;
  }

  return normalized;
}

router.get(
  "/forgotten-requests",
  authRequired,
  requireRole("ADMIN"),
  async (req, res) => {
    const schema = z.object({
      status: z.string().optional(),
      collaborator: z.string().optional(),
      forgotten_date_from: z.string().optional(),
      forgotten_date_to: z.string().optional(),
      created_from: z.string().optional(),
      created_to: z.string().optional(),
    });

    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Query invalida", details: parsed.error.flatten() });
    }

    const where = [];
    const params = [];
    let index = 1;

    const status = normalizeStatus(parsed.data.status);
    if (parsed.data.status && !status) {
      return res.status(400).json({ error: "status invalido" });
    }
    if (status) {
      where.push(`mpr.status = $${index++}`);
      params.push(status);
    }

    const collaborator = parsed.data.collaborator?.trim();
    if (collaborator) {
      const numericCollaboratorId = Number(collaborator);
      if (Number.isFinite(numericCollaboratorId) && numericCollaboratorId > 0) {
        where.push(`(mpr.user_id = $${index} OR u.id = $${index})`);
        params.push(numericCollaboratorId);
        index += 1;
      } else {
        where.push(`(u.name ILIKE $${index} OR mpr.employee_name ILIKE $${index} OR u.cpf ILIKE $${index})`);
        params.push(`%${collaborator}%`);
        index += 1;
      }
    }

    if (parsed.data.forgotten_date_from) {
      where.push(`mpr.forgotten_date >= $${index++}`);
      params.push(parsed.data.forgotten_date_from);
    }
    if (parsed.data.forgotten_date_to) {
      where.push(`mpr.forgotten_date <= $${index++}`);
      params.push(parsed.data.forgotten_date_to);
    }
    if (parsed.data.created_from) {
      where.push(`mpr.created_at >= $${index++}`);
      params.push(parsed.data.created_from);
    }
    if (parsed.data.created_to) {
      where.push(`mpr.created_at <= $${index++}`);
      params.push(parsed.data.created_to);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const result = await db.query(
      `
        SELECT
          mpr.id,
          mpr.user_id,
          mpr.employee_name,
          mpr.forgotten_date,
          mpr.entry_time,
          mpr.exit_time,
          mpr.reason,
          mpr.workplace,
          mpr.notes,
          mpr.confirmed_by_employee,
          mpr.signed_at,
          mpr.client_timestamp,
          mpr.client_timestamp_label,
          mpr.client_timezone,
          mpr.client_timezone_offset_minutes,
          mpr.client_latitude,
          mpr.client_longitude,
          mpr.client_ip,
          mpr.status,
          mpr.review_note,
          mpr.reviewed_at,
          mpr.reviewed_by,
          mpr.created_at,
          mpr.signature_path,
          u.name AS user_name,
          u.cpf AS user_cpf,
          reviewer.name AS reviewed_by_name
        FROM missed_punch_requests mpr
        JOIN users u ON u.id = mpr.user_id
        LEFT JOIN users reviewer ON reviewer.id = mpr.reviewed_by
        ${whereSql}
        ORDER BY mpr.created_at DESC, mpr.id DESC
      `,
      params,
    );

    return res.json({
      requests: result.rows.map((row) => normalizeRequestRow(row)),
    });
  },
);

router.get(
  "/forgotten-requests/:id",
  authRequired,
  requireRole("ADMIN"),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "ID invalido" });
    }

    const result = await db.query(
      `
        SELECT
          mpr.*,
          u.name AS user_name,
          u.cpf AS user_cpf,
          reviewer.name AS reviewed_by_name
        FROM missed_punch_requests mpr
        JOIN users u ON u.id = mpr.user_id
        LEFT JOIN users reviewer ON reviewer.id = mpr.reviewed_by
        WHERE mpr.id = $1
      `,
      [id],
    );
    const request = result.rows[0];
    if (!request) return res.status(404).json({ error: "Solicitacao nao encontrada" });

    try {
      return res.json({
        request: normalizeRequestRow(request, {
          includeSignature: true,
          includeIntegrity: true,
        }),
      });
    } catch {
      return res.status(500).json({ error: "Nao foi possivel carregar a assinatura" });
    }
  },
);

router.get(
  "/forgotten-requests/:id/integrity",
  authRequired,
  requireRole("ADMIN"),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "ID invalido" });
    }

    const result = await db.query(
      `
        SELECT id, status
        FROM missed_punch_requests
        WHERE id = $1
      `,
      [id],
    );
    const request = result.rows[0];
    if (!request) {
      return res.status(404).json({ error: "Solicitacao nao encontrada" });
    }
    if (request.status !== "APPROVED") {
      return res.status(409).json({ error: "Integridade disponivel apenas para solicitacoes aprovadas" });
    }
    if (!forgottenApprovalIntegrityExists(id)) {
      return res.status(404).json({ error: "Comprovante de integridade ainda nao gerado" });
    }

    return res.json({
      integrity: readForgottenApprovalIntegrity(id),
    });
  },
);

router.get(
  "/forgotten-requests/:id/pdf",
  authRequired,
  requireRole("ADMIN"),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "ID invalido" });
    }

    const result = await db.query(
      `
        SELECT id, employee_name, status
        FROM missed_punch_requests
        WHERE id = $1
      `,
      [id],
    );
    const request = result.rows[0];
    if (!request) {
      return res.status(404).json({ error: "Solicitacao nao encontrada" });
    }
    if (request.status !== "APPROVED") {
      return res.status(409).json({ error: "PDF disponivel apenas para solicitacoes aprovadas" });
    }

    const absolutePath = resolveForgottenApprovalPdfPath(id);
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ error: "PDF ainda nao gerado" });
    }

    return res.download(
      absolutePath,
      `autorizacao-lancamento-manual-${id}.pdf`,
    );
  },
);

router.patch(
  "/forgotten-requests/:id/review",
  authRequired,
  requireRole("ADMIN"),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "ID invalido" });
    }

    const schema = z.object({
      status: z.string(),
      review_notes: z.string().trim().max(1000).optional(),
      review_note: z.string().trim().max(1000).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Dados invalidos", details: parsed.error.flatten() });
    }

    const nextStatus = normalizeStatus(parsed.data.status);
    if (!nextStatus || nextStatus === "PENDING") {
      return res.status(400).json({ error: "status deve ser APPROVED ou REJECTED" });
    }

    const reviewNote = parsed.data.review_notes ?? parsed.data.review_note ?? null;

    let generatedPdfPath = null;
    let generatedIntegrity = null;
    try {
      const result = await db.withTransaction(async (tx) => {
        const requestResult = await tx.query(
          `
            SELECT *
            FROM missed_punch_requests
            WHERE id = $1
            FOR UPDATE
          `,
          [id],
        );
        const request = requestResult.rows[0];

        if (!request) {
          const error = new Error("Solicitacao nao encontrada");
          error.statusCode = 404;
          throw error;
        }

        if (request.status !== "PENDING") {
          const error = new Error("Solicitacao ja analisada");
          error.statusCode = 409;
          throw error;
        }

        const createdEntries = [];
        if (nextStatus === "APPROVED") {
          const entryTimes = [
            request.entry_time
              ? { type: "IN", time: String(request.entry_time).slice(0, 5) }
              : null,
            request.exit_time
              ? { type: "OUT", time: String(request.exit_time).slice(0, 5) }
              : null,
          ].filter(Boolean);

          for (const item of entryTimes) {
            const occurredAt = buildForgottenOccurredAt(request.forgotten_date, item.time);
            const insertResult = await tx.query(
              `
                INSERT INTO times_entries (
                  user_id,
                  type,
                  occurred_at,
                  note,
                  adjusted_by,
                  adjusted_at,
                  adjustment_note
                )
                VALUES ($1, $2, $3, $4, $5, NOW(), $6)
                RETURNING id, user_id, type, occurred_at, latitude, longitude,
                          location_address AS address, location_address
              `,
              [
                request.user_id,
                item.type,
                occurredAt,
                "FORGOTTEN_REQUEST_APPROVED",
                req.user.id,
                reviewNote || `Solicitacao de esquecimento #${id} aprovada`,
              ],
            );

            createdEntries.push(insertResult.rows[0]);
          }
        }

        await tx.query(
          `
            UPDATE missed_punch_requests
            SET status = $1,
                review_note = $2,
                reviewed_by = $3,
                reviewed_at = NOW()
            WHERE id = $4
          `,
          [nextStatus, reviewNote, req.user.id, id],
        );

        const updatedResult = await tx.query(
          `
            SELECT
              mpr.*,
              u.name AS user_name,
              u.cpf AS user_cpf,
              reviewer.name AS reviewed_by_name
            FROM missed_punch_requests mpr
            JOIN users u ON u.id = mpr.user_id
            LEFT JOIN users reviewer ON reviewer.id = mpr.reviewed_by
            WHERE mpr.id = $1
          `,
          [id],
        );

        return {
          request: updatedResult.rows[0],
          createdEntries,
        };
      });

      if (nextStatus === "APPROVED") {
        const request = result.request;
        const generatedDocument = await generateForgottenApprovalPdf({
          request,
          reviewerName: request.reviewed_by_name || req.user.name || "Departamento de Escalas",
          signatureAbsolutePath: request.signature_path
            ? resolveStoredPath(request.signature_path)
            : null,
        });
        generatedPdfPath = generatedDocument.relativePath;
        generatedIntegrity = generatedDocument.integrity;
      }

      return res.json({
        message:
          nextStatus === "APPROVED"
            ? "Solicitacao aprovada com sucesso"
            : "Solicitacao rejeitada com sucesso",
        request: normalizeRequestRow(result.request, { includeIntegrity: true }),
        created_entries: result.createdEntries,
        approval_pdf_url: generatedPdfPath
          ? `/admin/forgotten-requests/${result.request.id}/pdf`
          : null,
        integrity: generatedIntegrity,
      });
    } catch (error) {
      if (generatedPdfPath) {
        try {
          fs.unlinkSync(resolveForgottenApprovalPdfPath(id));
        } catch {}
      }
      if (error && error.statusCode) {
        return res.status(error.statusCode).json({ error: error.message });
      }

      console.error("[forgotten-review-error]", error);
      return res.status(500).json({
        error: error && error.message ? error.message : "Erro interno",
      });
    }
  },
);

module.exports = router;
