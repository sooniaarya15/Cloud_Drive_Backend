import pg from "pg";
import { env } from "../config/env.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.databaseUrl,
  ssl: { rejectUnauthorized: false }, // required for Supabase
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL pool error", err);
});

export async function query(text, params) {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;
  if (env.nodeEnv === "development") {
    console.log("Executed query", { text, duration, rows: result.rowCount });
  }
  return result;
}