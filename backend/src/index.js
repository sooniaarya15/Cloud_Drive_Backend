import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env.js";
import { pool } from "./db/pool.js";

const app = express();

app.use(helmet());
app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(express.json({ limit: "10mb" }));
app.use(morgan(env.nodeEnv === "development" ? "dev" : "combined"));

// Health check
app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", db: "connected" });
  } catch (err) {
    res.status(500).json({ status: "error", db: "disconnected" });
  }
});

app.get("/", (req, res) => {
  res.json({ message: "Cloud Drive API is running" });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({
    error: {
      code: err.code || "INTERNAL_ERROR",
      message: err.message || "Something went wrong",
    },
  });
});

app.listen(env.port, () => {
  console.log(`✅ Server running on http://localhost:${env.port}`);
});