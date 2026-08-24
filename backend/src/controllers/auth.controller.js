import { z } from "zod";
import { query } from "../db/pool.js";
import { hashPassword, comparePassword } from "../utils/password.js";
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from "../utils/jwt.js";
import { Errors } from "../utils/AppError.js";
import { env } from "../config/env.js";

export const registerSchema = z.object({
  name: z.string().min(1, "Name is required").max(150),
  email: z.string().email("Invalid email"),
  password: z.string().min(8, "Password must be at least 8 characters").max(100),
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(1, "Password is required"),
});

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
};

function setAuthCookies(res, accessToken, refreshToken) {
  res.cookie("access_token", accessToken, { ...COOKIE_OPTIONS, maxAge: 15 * 60 * 1000 });
  res.cookie("refresh_token", refreshToken, { ...COOKIE_OPTIONS, maxAge: 7 * 24 * 60 * 60 * 1000 });
}

function toPublicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    imageUrl: row.image_url,
    storageUsedBytes: Number(row.storage_used_bytes),
    storageQuotaBytes: Number(row.storage_quota_bytes),
  };
}

export async function register(req, res, next) {
  try {
    const { name, email, password } = req.body;
    const normalizedEmail = email.trim().toLowerCase();

    const existing = await query("SELECT id FROM users WHERE email = $1", [normalizedEmail]);
    if (existing.rowCount > 0) throw Errors.duplicateEmail(normalizedEmail);

    const passwordHash = await hashPassword(password);

    const result = await query(
      `INSERT INTO users (name, email, password_hash, auth_provider)
       VALUES ($1, $2, $3, 'LOCAL')
       RETURNING *`,
      [name.trim(), normalizedEmail, passwordHash]
    );

    const user = result.rows[0];
    const accessToken = generateAccessToken(user.id, user.email);
    const refreshToken = generateRefreshToken(user.id);

    setAuthCookies(res, accessToken, refreshToken);
    res.status(201).json({ accessToken, user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
}

export async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    const normalizedEmail = email.trim().toLowerCase();

    const result = await query("SELECT * FROM users WHERE email = $1", [normalizedEmail]);
    if (result.rowCount === 0) throw Errors.invalidCredentials();

    const user = result.rows[0];
    const valid = await comparePassword(password, user.password_hash);
    if (!valid) throw Errors.invalidCredentials();

    const accessToken = generateAccessToken(user.id, user.email);
    const refreshToken = generateRefreshToken(user.id);

    setAuthCookies(res, accessToken, refreshToken);
    res.json({ accessToken, user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
}

export async function logout(req, res) {
  res.clearCookie("access_token", COOKIE_OPTIONS);
  res.clearCookie("refresh_token", COOKIE_OPTIONS);
  res.json({ message: "Logged out" });
}

export async function refresh(req, res, next) {
  try {
    const token = req.cookies?.refresh_token;
    if (!token) throw Errors.unauthorized();

    const payload = verifyRefreshToken(token);
    const result = await query("SELECT * FROM users WHERE id = $1", [payload.sub]);
    if (result.rowCount === 0) throw Errors.unauthorized();

    const user = result.rows[0];
    const accessToken = generateAccessToken(user.id, user.email);
    const newRefreshToken = generateRefreshToken(user.id);

    setAuthCookies(res, accessToken, newRefreshToken);
    res.json({ accessToken });
  } catch (err) {
    next(Errors.unauthorized());
  }
}

export async function me(req, res, next) {
  try {
    const result = await query("SELECT * FROM users WHERE id = $1", [req.user.id]);
    if (result.rowCount === 0) throw Errors.notFound("User");
    res.json(toPublicUser(result.rows[0]));
  } catch (err) {
    next(err);
  }
}