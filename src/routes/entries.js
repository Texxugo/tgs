const express = require("express");
const { z } = require("zod");
const { db } = require("../db/database");
const { authRequired } = require("../middlewares/auth");

const router = express.Router();

router.get("/", authRequired, async (req, res) => {
  const schema = z.object({
    user_id: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  });

  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Query invalida" });

  const requestedUserId = parsed.data.user_id
    ? Number(parsed.data.user_id)
    : null;

  let targetUserId = req.user.id;

  if (requestedUserId !== null) {
    if (req.user.role !== "ADMIN") {
      return res.status(403).json({ error: "Sem permissao" });
    }
    targetUserId = requestedUserId;
  }

  const where = ["user_id = $1"];
  const params = [targetUserId];
  let index = 2;

  if (parsed.data.from) {
    where.push(`occurred_at >= $${index++}`);
    params.push(parsed.data.from);
  }
  if (parsed.data.to) {
    where.push(`occurred_at <= $${index++}`);
    params.push(parsed.data.to);
  }

  const { rows } = await db.query(
    `
      SELECT id, user_id, type, occurred_at, latitude, longitude,
             location_address AS address, location_address
      FROM times_entries
      WHERE ${where.join(" AND ")}
      ORDER BY occurred_at DESC, id DESC
    `,
    params,
  );

  return res.json({ entries: rows });
});

router.get("/all", authRequired, async (req, res) => {
  if (req.user.role !== "ADMIN") {
    return res.status(403).json({ error: "Sem permissao" });
  }

  const schema = z.object({
    from: z.string().optional(),
    to: z.string().optional(),
  });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Query invalida" });

  const where = [];
  const params = [];
  let index = 1;

  if (parsed.data.from) {
    where.push(`te.occurred_at >= $${index++}`);
    params.push(parsed.data.from);
  }
  if (parsed.data.to) {
    where.push(`te.occurred_at <= $${index++}`);
    params.push(parsed.data.to);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const { rows } = await db.query(
    `
      SELECT te.id, te.user_id, u.name, u.cpf, te.type, te.occurred_at,
             te.latitude, te.longitude, te.location_address AS address, te.location_address
      FROM times_entries te
      JOIN users u ON u.id = te.user_id
      ${whereSql}
      ORDER BY te.occurred_at DESC, te.id DESC
    `,
    params,
  );

  return res.json({ entries: rows });
});

module.exports = router;
