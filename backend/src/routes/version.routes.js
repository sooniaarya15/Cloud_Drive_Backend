import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";
import { uploadNewVersion, listVersions, revertToVersion } from "../controllers/version.controller.js";

const router = Router();
router.use(requireAuth);

router.post("/:id/versions", upload.single("file"), uploadNewVersion);
router.get("/:id/versions", listVersions);
router.post("/:id/versions/:versionId/revert", revertToVersion);

export default router;