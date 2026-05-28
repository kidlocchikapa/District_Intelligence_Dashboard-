const { Pool } = require("pg");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

function normalizeConnectionString(connectionString) {
  try {
    const url = new URL(connectionString.trim());
    if (
      url.searchParams.get("sslmode") === "require" &&
      url.searchParams.get("channel_binding") === "require"
    ) {
      url.searchParams.delete("channel_binding");
    }
    return url.toString();
  } catch {
    return connectionString
      .trim()
      .replace("?sslmode=require&channel_binding=require", "?sslmode=require");
  }
}

// Build the connection string based on environment variables
function buildConnectionString() {
  if (process.env.DATABASE_URL) {
    return normalizeConnectionString(process.env.DATABASE_URL);
  }

  // Fallback to individual environment variables if DATABASE_URL is not set
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  const host = process.env.DB_HOST || "localhost";
  const port = process.env.DB_PORT || "5432";
  const name = process.env.DB_NAME;

  if (!user || !password || !name) {
    return null;
  }

  return normalizeConnectionString(`postgresql://${user}:${password}@${host}:${port}/${name}`);
}

const connectionString = buildConnectionString();

if (!connectionString) {
  throw new Error(
    "Database configuration is missing. Set DATABASE_URL or DB_USER/DB_PASSWORD/DB_HOST/DB_PORT/DB_NAME.",
  );
}

// Create a new pool instance with the connection string
const pool = new Pool({ connectionString });

pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client', err);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
