import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

const ACCESS_TOKEN_EXPIRY = "15m";
const REFRESH_TOKEN_EXPIRY = "7d";

export function generateAccessToken(userId, email) {
  return jwt.sign({ sub: userId, email }, env.jwtSecret, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
  });
}

export function generateRefreshToken(userId) {
  return jwt.sign({ sub: userId }, env.jwtRefreshSecret, {
    expiresIn: REFRESH_TOKEN_EXPIRY,
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, env.jwtSecret); // throws if invalid/expired
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, env.jwtRefreshSecret);
}