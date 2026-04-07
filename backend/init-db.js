const fs = require("fs");
const path = require("path");
const { pool } = require("./db");

async function initDb() {
  try {
    const schemaPath = path.join(__dirname, "../database/schema.sql");
    const schema = fs.readFileSync(schemaPath, "utf8");

    console.log("Initializing database schema...");
    await pool.query(schema);
    console.log("Database schema initialized successfully.");

    process.exit(0);
  } catch (err) {
    console.error("Error initializing database: ", err);
    process.exit(1);
  }
}

initDb();
