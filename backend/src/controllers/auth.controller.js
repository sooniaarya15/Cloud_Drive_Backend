import { z } from "zod";
import crypto from "crypto";
import { query } from "../db/pool.js";
import { hashPassword, comparePassword } from "../utils/password.js";
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from "../utils/jwt.js";
import { Errors } from "../utils/AppError.js";
import { linkPendingShares } from "./share.controller.js";

export const registerSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(150)
    .regex(/^[A-Za-z\s.'-]+$/, "Name can only contain letters and spaces"),
  email: z.string().email("Invalid email"),
  password: z.string().min(8, "Password must be at least 8 characters").max(100),
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(1, "Password is required"),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email"),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, "Token is required"),
  newPassword: z.string().min(8, "Password must be at least 8 characters").max(100),
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
    // Link any shares that were created for this email before they signed up
    await linkPendingShares(user.id, user.email);
    
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

/** POST /api/auth/forgot-password — generates a reset token */
export async function forgotPassword(req, res, next) {
  try {
    const { email } = req.body;
    const normalizedEmail = email.trim().toLowerCase();

    const result = await query("SELECT id FROM users WHERE email = $1", [normalizedEmail]);

    // Always respond the same way, whether or not the email exists —
    // this prevents attackers from using this endpoint to discover registered emails.
    if (result.rowCount === 0) {
      return res.json({ message: "If that email exists, a reset link has been sent." });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await query(
      "UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE email = $3",
      [resetToken, expiresAt, normalizedEmail]
    );

    const resetUrl = `${process.env.CORS_ORIGIN}/reset-password/${resetToken}`;

    // TODO: send this via a real email service (e.g. Resend, SendGrid) in production.
    // For now (no email service configured), it's logged so you can test the flow.
    console.log("🔑 Password reset link:", resetUrl);

    res.json({
      message: "If that email exists, a reset link has been sent.",
      // Only included in development so you can test without an email service.
      ...(process.env.NODE_ENV === "development" && { devResetUrl: resetUrl }),
    });
  } catch (err) {
    next(err);
  }
}

/** POST /api/auth/reset-password — consumes the token, sets a new password */
export async function resetPassword(req, res, next) {
  try {
    const { token, newPassword } = req.body;

    const result = await query(
      "SELECT * FROM users WHERE reset_token = $1 AND reset_token_expires > now()",
      [token]
    );
    if (result.rowCount === 0) {
      throw Errors.validation("This reset link is invalid or has expired");
    }

    const user = result.rows[0];
    const passwordHash = await hashPassword(newPassword);

    await query(
      "UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2",
      [passwordHash, user.id]
    );

    res.json({ message: "Password reset successfully. You can now log in." });
  } catch (err) {
    next(err);
  }
}