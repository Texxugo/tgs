const { Pool } = require("pg");

function parseBooleanEnv(value, defaultValue = false) {
  if (value == null || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function buildSslConfig() {
  const sslEnabled = parseBooleanEnv(process.env.DB_SSL, false);
  const caCert = process.env.DB_CA_CERT || process.env.CA_CERT;

  if (!sslEnabled && !caCert) return undefined;

  const rejectUnauthorized = parseBooleanEnv(
    process.env.DB_SSL_REJECT_UNAUTHORIZED,
    true,
  );

  if (!caCert) {
    return { rejectUnauthorized };
  }

  return {
    rejectUnauthorized,
    ca: caCert.replace(/\\n/g, "\n"),
  };
}

function buildPoolConfig() {
  const ssl = buildSslConfig();
  const connectionString = String(process.env.DATABASE_URL || "").trim();

  if (connectionString) {
    return {
      connectionString,
      ...(ssl ? { ssl } : {}),
    };
  }

  return {
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || "sistema_ponto",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "",
    ...(ssl ? { ssl } : {}),
  };
}

const poolConfig = buildPoolConfig();
const pool = new Pool(poolConfig);

async function query(text, params = []) {
  return pool.query(text, params);
}

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tx = {
      query(text, params = []) {
        return client.query(text, params);
      },
    };
    const result = await fn(tx);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

const db = { query, withTransaction };

module.exports = { db, pool, poolConfig, buildPoolConfig };
