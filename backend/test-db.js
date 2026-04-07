const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function testConnection() {
  console.log("Testing connection to:", process.env.DATABASE_URL);
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    const res = await pool.query('SELECT current_database(), count(*) from administrative_units');
    console.log("SUCCESS!");
    console.log("Current Database:", res.rows[0].current_database);
    console.log("Count in admin_units:", res.rows[0].count);
  } catch (err) {
    console.error("CONNECTION ERROR:", err.message);
    if (err.message.includes('does not exist')) {
       console.log("Tip: Try removing the trailing space in the database name.");
    }
  } finally {
    await pool.end();
  }
}

testConnection();
