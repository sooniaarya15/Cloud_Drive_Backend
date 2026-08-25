import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { upload } from "../middleware/upload.js";
import {
  uploadFile,
  initUpload,
  completeUpload,
  getFile,
  listFiles,
  updateFile,
  trashFile,
  restoreFile,
  deleteFilePermanently,
  initUploadSchema,
  renameFileSchema,
  moveFileSchema,
} from "../controllers/file.controller.js";

const router = Router();

router.use(requireAuth);

router.get("/", listFiles);
router.post("/upload", upload.single("file"), uploadFile);
router.post("/init", validate(initUploadSchema), initUpload);
router.post("/complete", completeUpload);

router.get("/:id", getFile);
router.patch("/:id", updateFile); // { name?, folderId? } — matches spec 9.3
router.post("/:id/trash", trashFile);
router.post("/:id/restore", restoreFile);
router.delete("/:id", deleteFilePermanently); // permanent delete (Trash -> Delete Forever)

export default router;