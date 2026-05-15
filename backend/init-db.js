const fs = require("fs");
const path = require("path");
const { pool } = require("./db");

const MAX_ATTEMPTS = Number(process.env.DB_INIT_MAX_ATTEMPTS || 30);
const RETRY_DELAY_MS = Number(process.env.DB_INIT_RETRY_DELAY_MS || 2000);
const RETRYABLE_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "ETIMEDOUT",
  "57P03",
]);

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableDbError(err) {
  return RETRYABLE_CODES.has(err.code) || RETRYABLE_CODES.has(err.errno);
}

async function initDb() {
  const schemaPath = path.join(__dirname, "../database/schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      console.log(
        `Initializing database schema... (attempt ${attempt}/${MAX_ATTEMPTS})`,
      );
      await pool.query(schema);
      console.log("Database schema initialized successfully.");

      process.exit(0);
    } catch (err) {
      if (attempt < MAX_ATTEMPTS && isRetryableDbError(err)) {
        console.warn(
          `Database is not ready yet (${err.code || err.errno}); retrying in ${RETRY_DELAY_MS}ms...`,
        );
        await wait(RETRY_DELAY_MS);
        continue;
      }

      console.error("Error initializing database: ", err);
      process.exit(1);
    }
  }
}

initDb();
