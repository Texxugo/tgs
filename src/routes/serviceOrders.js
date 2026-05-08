const express = require("express");
const { z } = require("zod");
const { db } = require("../db/database");
const { authRequired } = require("../middlewares/auth");
const { requireRole } = require("../middlewares/requireRole");

const router = express.Router();

const namedValueSchema = z.object({
  name: z.string().trim().min(2).max(120),
});

const serviceOrderSchema = z
  .object({
    location_id: z.number().int().positive(),
    occurrence_type_id: z.number().int().positive(),
    replaced_user_id: z.number().int().positive(),
    cover_user_id: z.number().int().positive(),
    expected_start: z.string().min(1),
    expected_duration_hours: z.number().int().positive(),
  })
  .refine((data) => data.replaced_user_id !== data.cover_user_id, {
    message: "Funcionarios de substituicao e cobertura devem ser diferentes",
    path: ["cover_user_id"],
  });

const serviceOrderSelectSql = `
  SELECT
    so.*,
    loc.name AS location_name,
    ot.name AS occurrence_type_name,
    ru.name AS replaced_user_name,
    cu.name AS cover_user_name,
    u.name AS created_by_name
  FROM service_orders so
  JOIN users u ON u.id = so.created_by
  LEFT JOIN service_order_locations loc ON loc.id = so.location_id
  LEFT JOIN occurrence_types ot ON ot.id = so.occurrence_type_id
  LEFT JOIN users ru ON ru.id = so.replaced_user_id
  LEFT JOIN users cu ON cu.id = so.cover_user_id
`;

async function fetchServiceOrderById(id) {
  const result = await db.query(
    `${serviceOrderSelectSql}
     WHERE so.id = $1`,
    [id],
  );
  return result.rows[0] || null;
}

async function fetchMetadata() {
  const [locationsResult, occurrenceTypesResult, usersResult] = await Promise.all([
    db.query(
      `
        SELECT id, name, created_at
        FROM service_order_locations
        ORDER BY name ASC
      `,
    ),
    db.query(
      `
        SELECT id, name, created_at
        FROM occurrence_types
        ORDER BY name ASC
      `,
    ),
    db.query(
      `
        SELECT id, name, cpf, role
        FROM users
        WHERE is_active = 1
        ORDER BY name ASC, id ASC
      `,
    ),
  ]);

  return {
    locations: locationsResult.rows,
    occurrence_types: occurrenceTypesResult.rows,
    users: usersResult.rows,
  };
}

async function ensureNamedValueDoesNotExist(tableName, name) {
  const result = await db.query(
    `SELECT id FROM ${tableName} WHERE LOWER(name) = LOWER($1) LIMIT 1`,
    [name],
  );
  return !!result.rows[0];
}

router.get("/metadata", authRequired, requireRole("ADMIN"), async (req, res) => {
  const metadata = await fetchMetadata();
  return res.json(metadata);
});

router.post("/locations", authRequired, requireRole("ADMIN"), async (req, res) => {
  const parsed = namedValueSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Dados invalidos", details: parsed.error.flatten() });
  }

  const { name } = parsed.data;
  if (await ensureNamedValueDoesNotExist("service_order_locations", name)) {
    return res.status(409).json({ error: "Local ja cadastrado" });
  }

  const insertResult = await db.query(
    `
      INSERT INTO service_order_locations (name)
      VALUES ($1)
      RETURNING id, name, created_at
    `,
    [name],
  );

  return res.status(201).json({ location: insertResult.rows[0] });
});

router.post(
  "/occurrence-types",
  authRequired,
  requireRole("ADMIN"),
  async (req, res) => {
    const parsed = namedValueSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Dados invalidos", details: parsed.error.flatten() });
    }

    const { name } = parsed.data;
    if (await ensureNamedValueDoesNotExist("occurrence_types", name)) {
      return res.status(409).json({ error: "Tipo de ocorrencia ja cadastrado" });
    }

    const insertResult = await db.query(
      `
        INSERT INTO occurrence_types (name)
        VALUES ($1)
        RETURNING id, name, created_at
      `,
      [name],
    );

    return res.status(201).json({ occurrence_type: insertResult.rows[0] });
  },
);

router.post("/", authRequired, requireRole("ADMIN"), async (req, res) => {
  const parsed = serviceOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Dados invalidos", details: parsed.error.flatten() });
  }

  const {
    location_id,
    occurrence_type_id,
    replaced_user_id,
    cover_user_id,
    expected_start,
    expected_duration_hours,
  } = parsed.data;

  let serviceOrderId;

  try {
    serviceOrderId = await db.withTransaction(async (tx) => {
      const locationResult = await tx.query(
        `
          SELECT id, name
          FROM service_order_locations
          WHERE id = $1
        `,
        [location_id],
      );
      const occurrenceTypeResult = await tx.query(
        `
          SELECT id, name
          FROM occurrence_types
          WHERE id = $1
        `,
        [occurrence_type_id],
      );
      const usersResult = await tx.query(
        `
          SELECT id, name, is_active
          FROM users
          WHERE id = ANY($1::int[])
        `,
        [[replaced_user_id, cover_user_id]],
      );

      const location = locationResult.rows[0];
      if (!location) {
        const err = new Error("Local nao encontrado");
        err.status = 404;
        throw err;
      }

      const occurrenceType = occurrenceTypeResult.rows[0];
      if (!occurrenceType) {
        const err = new Error("Tipo de ocorrencia nao encontrado");
        err.status = 404;
        throw err;
      }

      if (usersResult.rows.length !== 2) {
        const err = new Error("Funcionario nao encontrado");
        err.status = 404;
        throw err;
      }

      const inactiveUser = usersResult.rows.find((user) => Number(user.is_active) !== 1);
      if (inactiveUser) {
        const err = new Error("Funcionario inativo nao pode ser usado neste cadastro");
        err.status = 400;
        throw err;
      }

      const generatedTitle = `${occurrenceType.name} - ${location.name}`;
      const insertResult = await tx.query(
        `
          INSERT INTO service_orders (
            title,
            description,
            location_text,
            expected_start,
            expected_duration_hours,
            created_by,
            location_id,
            occurrence_type_id,
            replaced_user_id,
            cover_user_id
          )
          VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING id
        `,
        [
          generatedTitle,
          location.name,
          expected_start,
          expected_duration_hours,
          req.user.id,
          location_id,
          occurrence_type_id,
          replaced_user_id,
          cover_user_id,
        ],
      );

      const id = insertResult.rows[0].id;
      await tx.query(
        `
          INSERT INTO service_order_assignments (service_order_id, user_id)
          VALUES ($1, $2)
        `,
        [id, cover_user_id],
      );

      return id;
    });
  } catch (err) {
    if (err && err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    throw err;
  }

  const created = await fetchServiceOrderById(serviceOrderId);
  return res.status(201).json({ service_order: created });
});

router.get("/", authRequired, requireRole("ADMIN"), async (req, res) => {
  const result = await db.query(
    `
      ${serviceOrderSelectSql}
      ORDER BY so.created_at DESC
    `,
  );
  return res.json({ service_orders: result.rows });
});

router.post("/:id/assign", authRequired, requireRole("ADMIN"), async (req, res) => {
  const serviceOrderId = Number(req.params.id);
  if (!Number.isFinite(serviceOrderId) || serviceOrderId <= 0) {
    return res.status(400).json({ error: "ID invalido" });
  }

  const schema = z.object({ user_id: z.number().int().positive() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Dados invalidos", details: parsed.error.flatten() });
  }

  const { user_id } = parsed.data;
  const soResult = await db.query("SELECT id FROM service_orders WHERE id = $1", [serviceOrderId]);
  if (!soResult.rows[0]) return res.status(404).json({ error: "OS nao encontrada" });

  const userResult = await db.query(
    `
      SELECT id, is_active
      FROM users
      WHERE id = $1
    `,
    [user_id],
  );
  if (!userResult.rows[0]) return res.status(404).json({ error: "Usuario nao encontrado" });
  if (Number(userResult.rows[0].is_active) !== 1) {
    return res.status(400).json({ error: "Usuario inativo nao pode ser atribuido" });
  }

  try {
    await db.withTransaction(async (tx) => {
      await tx.query(
        `
          UPDATE service_orders
          SET cover_user_id = $1
          WHERE id = $2
        `,
        [user_id, serviceOrderId],
      );

      await tx.query(
        "INSERT INTO service_order_assignments (service_order_id, user_id) VALUES ($1, $2)",
        [serviceOrderId, user_id],
      );
    });
  } catch (err) {
    if (err && err.code === "23505") {
      return res.status(409).json({ error: "Usuario ja atribuido a OS" });
    }
    throw err;
  }

  const updated = await fetchServiceOrderById(serviceOrderId);
  return res.status(201).json({ service_order: updated, message: "Usuario atribuido com sucesso" });
});

router.patch("/:id/close", authRequired, requireRole("ADMIN"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: "ID invalido" });
  }

  const soResult = await db.query("SELECT id, status FROM service_orders WHERE id = $1", [id]);
  const so = soResult.rows[0];
  if (!so) return res.status(404).json({ error: "OS nao encontrada" });
  if (so.status === "CLOSED") return res.status(409).json({ error: "OS ja esta encerrada" });

  await db.query(
    `
      UPDATE service_orders
      SET status = 'CLOSED', closed_at = NOW(), closed_by = $1
      WHERE id = $2
    `,
    [req.user.id, id],
  );

  const updated = await fetchServiceOrderById(id);
  return res.json({ service_order: updated });
});

module.exports = router;
