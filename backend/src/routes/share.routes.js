import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  createShare,
  listShares,
  deleteShare,
  listSharedWithMe,
  createLinkShare,
  resolveLink,
  deleteLinkShare,
  createShareSchema,
  createLinkShareSchema,
} from "../controllers/share.controller.js";

const router = Router();

// Public route — no auth required to resolve a link (matches spec 9.5)
router.get("/link/:token", resolveLink);

router.use(requireAuth);

router.post("/shares", validate(createShareSchema), createShare);
router.get("/shares/shared-with-me", listSharedWithMe);
router.get("/shares/:resourceType/:resourceId", listShares);
router.delete("/shares/:id", deleteShare);

router.post("/link-shares", validate(createLinkShareSchema), createLinkShare);
router.delete("/link-shares/:id", deleteLinkShare);

export default router;