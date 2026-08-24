import { verifyAccessToken } from "../utils/jwt.js";
import { Errors } from "../utils/AppError.js";

/**
 * Reads the access token from the Authorization header (Bearer <token>)
 * OR from an httpOnly cookie named "access_token" (whichever is present).
 * Attaches { id, email } to req.user on success.
 */
export function requireAuth(req, res, next) {
  try {
    let token = null;

    const header = req.headers.authorization;
    if (header && header.startsWith("Bearer ")) {
      token = header.substring(7);
    } else if (req.cookies?.access_token) {
      token = req.cookies.access_token;
    }

    if (!token) throw Errors.unauthorized();

    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch (err) {
    next(Errors.unauthorized());
  }
}