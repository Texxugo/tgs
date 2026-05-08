const { Pool } = require("pg");

const ca = process.env.CA_CERT
    ? process.env.CA_CERT.replace(/\\n/g, "\n")
    : undefined;

const poolConfig = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: ca ? { rejectUnauthorized: true, ca } : undefined,
  };

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
