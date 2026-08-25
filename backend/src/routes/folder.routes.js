import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  createFolder,
  getFolder,
  updateFolder,
  deleteFolder,
  createFolderSchema,
  updateFolderSchema,
} from "../controllers/folder.controller.js";

const router = Router();

router.use(requireAuth);

router.post("/", validate(createFolderSchema), createFolder);
router.get("/:id", getFolder); // use "root" as :id for the top level
router.patch("/:id", validate(updateFolderSchema), updateFolder);
router.delete("/:id", deleteFolder);

export default router;