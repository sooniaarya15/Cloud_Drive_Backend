import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { upload } from "../middleware/upload.js";
import {
  uploadFile,
  initUpload,
  completeUpload,
  getFile,
  deleteFilePermanently,
  initUploadSchema,
} from "../controllers/file.controller.js";

const router = Router();

router.use(requireAuth); // every route below requires a valid access token

// Small-file direct upload (multipart/form-data)
router.post("/upload", upload.single("file"), uploadFile);

// Large-file presigned flow
router.post("/init", validate(initUploadSchema), initUpload);
router.post("/complete", completeUpload);

router.get("/:id", getFile);
router.delete("/:id", deleteFilePermanently);

export default router;