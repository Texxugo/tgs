const { Pool } = require("pg");

const ca = process.env.CA_CERT
  ? process.env.CA_CERT.replace(/\\n/g, "\n")
  : undefined;

function toBoolean(value, fallback = false) {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function buildSslConfig() {
  const sslEnabled = toBoolean(process.env.DB_SSL, false) || !!ca;
  if (!sslEnabled) return undefined;

  const rejectUnauthorized = toBoolean(
    process.env.DB_SSL_REJECT_UNAUTHORIZED,
    true,
  );

  if (ca) {
    return { rejectUnauthorized, ca };
  }

  return { rejectUnauthorized };
}

function buildPoolConfig() {
  const ssl = buildSslConfig();
  const databaseUrl = String(process.env.DATABASE_URL || "").trim();

  if (databaseUrl) {
    return {
      connectionString: databaseUrl,
      ssl,
    };
  }

  return {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl,
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

module.exports = { db, pool, poolConfig };
