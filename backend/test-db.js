import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const { Pool } = pg;

console.log("Connecting to:", process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":****@"));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

try {
  const result = await pool.query("SELECT NOW()");
  console.log("✅ Connected successfully!", result.rows[0]);
} catch (err) {
  console.error("❌ Connection failed");
  console.error("Error code:", err.code);
  console.error("Error message:", err.message);
} finally {
  await pool.end();
}