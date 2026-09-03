import { z } from "zod";
import { query } from "../db/pool.js";
import { Errors } from "../utils/AppError.js";

export const starSchema = z.object({
  resourceType: z.enum(["file", "folder"]),
  resourceId: z.string().uuid(),
});

export async function addStar(req, res, next) {
  try {
    const { resourceType, resourceId } = req.body;

    if (resourceType === "file") {
      await query("UPDATE files SET is_starred = true WHERE id = $1 AND owner_id = $2", [
        resourceId, req.user.id,
      ]);
    }

    await query(
      `INSERT INTO stars (user_id, resource_type, resource_id) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [req.user.id, resourceType, resourceId]
    );

    res.status(201).json({ starred: true });
  } catch (err) {
    next(err);
  }
}

export async function removeStar(req, res, next) {
  try {
    const { resourceType, resourceId } = req.body;

    if (resourceType === "file") {
      await query("UPDATE files SET is_starred = false WHERE id = $1 AND owner_id = $2", [
        resourceId, req.user.id,
      ]);
    }

    await query("DELETE FROM stars WHERE user_id = $1 AND resource_type = $2 AND resource_id = $3", [
      req.user.id, resourceType, resourceId,
    ]);

    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function listTrash(req, res, next) {
  try {
    const [files, folders] = await Promise.all([
      query(
        "SELECT * FROM files WHERE owner_id = $1 AND is_deleted = true ORDER BY deleted_at DESC",
        [req.user.id]
      ),
      query(
        "SELECT * FROM folders WHERE owner_id = $1 AND is_deleted = true ORDER BY deleted_at DESC",
        [req.user.id]
      ),
    ]);

    res.json({
      files: files.rows.map((f) => ({
        id: f.id, name: f.name, sizeBytes: Number(f.size_bytes), deletedAt: f.deleted_at,
      })),
      folders: folders.rows.map((f) => ({ id: f.id, name: f.name, deletedAt: f.deleted_at })),
    });
  } catch (err) {
    next(err);
  }
}

export const trashRestoreSchema = z.object({
  resourceType: z.enum(["file", "folder"]),
  resourceId: z.string().uuid(),
});

export async function restoreFromTrash(req, res, next) {
  try {
    const { resourceType, resourceId } = req.body;
    const table = resourceType === "file" ? "files" : "folders";

    const result = await query(
      `UPDATE ${table} SET is_deleted = false, deleted_at = null
       WHERE id = $1 AND owner_id = $2 RETURNING id`,
      [resourceId, req.user.id]
    );
    if (result.rowCount === 0) throw Errors.notFound(resourceType === "file" ? "File" : "Folder");

    res.status(200).json({ restored: true });
  } catch (err) {
    next(err);
  }
}