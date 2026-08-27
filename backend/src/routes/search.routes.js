import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { search, recentFiles } from "../controllers/search.controller.js";
import {
  addStar,
  removeStar,
  listTrash,
  restoreFromTrash,
  starSchema,
  trashRestoreSchema,
} from "../controllers/star.controller.js";

const router = Router();
router.use(requireAuth);

router.get("/search", search);
router.get("/recent", recentFiles);

router.post("/stars", validate(starSchema), addStar);
router.delete("/stars", validate(starSchema), removeStar);

router.get("/trash", listTrash);
router.post("/trash/restore", validate(trashRestoreSchema), restoreFromTrash);

export default router;