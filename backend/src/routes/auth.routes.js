import { Router } from "express";
import passport from "../config/passport.js";
import { validate } from "../middleware/validate.js";
import { requireAuth } from "../middleware/auth.js";
import {
  register,
  login,
  logout,
  refresh,
  me,
  registerSchema,
  loginSchema,
} from "../controllers/auth.controller.js";
import { generateAccessToken, generateRefreshToken } from "../utils/jwt.js";

const router = Router();

router.post("/register", validate(registerSchema), register);
router.post("/login", validate(loginSchema), login);
router.post("/logout", logout);
router.post("/refresh", refresh);
router.get("/me", requireAuth, me);

// Google OAuth flow
router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"], session: false })
);

router.get(
  "/google/callback",
  passport.authenticate("google", { session: false, failureRedirect: "/login" }),
  (req, res) => {
    const user = req.user;
    const accessToken = generateAccessToken(user.id, user.email);
    const refreshToken = generateRefreshToken(user.id);

    res.cookie("access_token", accessToken, { httpOnly: true, maxAge: 15 * 60 * 1000 });
    res.cookie("refresh_token", refreshToken, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });

    // Redirect back to frontend after successful login
    res.redirect(`${process.env.CORS_ORIGIN}/auth/callback`);
  }
);

export default router;