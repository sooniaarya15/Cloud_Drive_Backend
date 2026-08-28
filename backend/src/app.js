// backend/src/app.js
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import passport from "./config/passport.js";
import { env } from "./config/env.js";
import { pool } from "./db/pool.js";
import authRoutes from "./routes/auth.routes.js";
import fileRoutes from "./routes/file.routes.js";
import folderRoutes from "./routes/folder.routes.js";
import shareRoutes from "./routes/share.routes.js";
import searchRoutes from "./routes/search.routes.js";
import { errorHandler } from "./middleware/errorHandler.js";

export const app = express();

app.use(helmet());
app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());
app.use(morgan(env.nodeEnv === "development" ? "dev" : "combined"));
app.use(passport.initialize());

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", db: "connected" });
  } catch (err) {
    res.status(500).json({ status: "error", db: "disconnected" });
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/files", fileRoutes);
app.use("/api/folders", folderRoutes);
app.use("/api", shareRoutes);
app.use("/api", searchRoutes);

app.use((req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } });
});

app.use(errorHandler);