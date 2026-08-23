import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;

export async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

export async function comparePassword(plainPassword, hash) {
  if (!hash) return false; // OAuth-only users have no password hash
  return bcrypt.compare(plainPassword, hash);
}