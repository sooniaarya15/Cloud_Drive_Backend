import { z } from "zod";
import { query } from "../db/pool.js";
import { buildStorageKey } from "../utils/storageKey.js";
import { uploadObject, getSignedDownloadUrl, getSignedUploadUrl, deleteObject } from "../services/storage.service.js";
import { Errors } from "../utils/AppError.js";

export const initUploadSchema = z.object({
  name: z.string().min(1).max(255),
  mimeType: z.string().min(1),
  sizeBytes: z.number().positive(),
  folderId: z.string().uuid().nullable().optional(),
});

function toFileResponse(row) {
  return {
    id: row.id,
    name: row.name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    folderId: row.folder_id,
    starred: row.is_starred,
    deleted: row.is_deleted,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * PATH A: Direct small-file upload.
 * multipart/form-data, field name "file". Server receives bytes and pushes to Supabase Storage.
 */
export async function uploadFile(req, res, next) {
  try {
    if (!req.file) throw Errors.validation("No file provided");

    const ownerId = req.user.id;
    const folderId = req.body.folderId || null;
    const storageKey = buildStorageKey(ownerId, req.file.originalname);

    await uploadObject(storageKey, req.file.buffer, req.file.mimetype);

    const result = await query(
      `INSERT INTO files (name, mime_type, size_bytes, storage_key, owner_id, folder_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [req.file.originalname, req.file.mimetype, req.file.size, storageKey, ownerId, folderId]
    );

    await query(
      "UPDATE users SET storage_used_bytes = storage_used_bytes + $1 WHERE id = $2",
      [req.file.size, ownerId]
    );

    await query(
      `INSERT INTO activities (actor_id, action, resource_type, resource_id, context)
       VALUES ($1, 'upload', 'file', $2, $3)`,
      [ownerId, result.rows[0].id, JSON.stringify({ name: req.file.originalname })]
    );

    res.status(201).json(toFileResponse(result.rows[0]));
  } catch (err) {
    next(err);
  }
}

/**
 * PATH B: Presigned upload flow for large files.
 * Step 1: client calls this -> gets a DB placeholder row + a signed upload URL.
 */
export async function initUpload(req, res, next) {
  try {
    const { name, mimeType, sizeBytes, folderId } = req.body;
    const ownerId = req.user.id;

    const storageKey = buildStorageKey(ownerId, name);

    const result = await query(
      `INSERT INTO files (name, mime_type, size_bytes, storage_key, owner_id, folder_id, is_deleted)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       RETURNING *`,
      [name, mimeType, sizeBytes, storageKey, ownerId, folderId || null]
      // is_deleted=true used as a temporary "not-yet-uploaded" flag; flipped to false in complete-upload
    );

    const { signedUrl, token } = await getSignedUploadUrl(storageKey);

    res.status(201).json({
      fileId: result.rows[0].id,
      storageKey,
      uploadUrl: signedUrl,
      uploadToken: token,
    });
  } catch (err) {
    next(err);
  }
}

/** Step 2: client confirms the upload finished; finalize the DB row. */
export async function completeUpload(req, res, next) {
  try {
    const { fileId } = req.body;
    const ownerId = req.user.id;

    const existing = await query("SELECT * FROM files WHERE id = $1 AND owner_id = $2", [fileId, ownerId]);
    if (existing.rowCount === 0) throw Errors.notFound("File");

    const file = existing.rows[0];

    const result = await query(
      "UPDATE files SET is_deleted = false, updated_at = now() WHERE id = $1 RETURNING *",
      [fileId]
    );

    await query(
      "UPDATE users SET storage_used_bytes = storage_used_bytes + $1 WHERE id = $2",
      [file.size_bytes, ownerId]
    );

    res.json(toFileResponse(result.rows[0]));
  } catch (err) {
    next(err);
  }
}

export async function getFile(req, res, next) {
  try {
    const { id } = req.params;
    const result = await query(
      "SELECT * FROM files WHERE id = $1 AND owner_id = $2 AND is_deleted = false",
      [id, req.user.id]
    );
    if (result.rowCount === 0) throw Errors.notFound("File");

    const file = result.rows[0];
    const signedUrl = await getSignedDownloadUrl(file.storage_key);

    res.json({ file: toFileResponse(file), signedUrl });
  } catch (err) {
    next(err);
  }
}

export async function deleteFilePermanently(req, res, next) {
  try {
    const { id } = req.params;
    const result = await query("SELECT * FROM files WHERE id = $1 AND owner_id = $2", [id, req.user.id]);
    if (result.rowCount === 0) throw Errors.notFound("File");

    const file = result.rows[0];
    await deleteObject(file.storage_key);
    await query("DELETE FROM files WHERE id = $1", [id]);
    await query(
      "UPDATE users SET storage_used_bytes = GREATEST(0, storage_used_bytes - $1) WHERE id = $2",
      [file.size_bytes, req.user.id]
    );

    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export const renameFileSchema = z.object({
  name: z.string().min(1).max(255),
});

export const moveFileSchema = z.object({
  folderId: z.string().uuid().nullable(),
});

/** PATCH /api/files/:id — rename and/or move (matches spec: { name?, folderId? }) */
export async function updateFile(req, res, next) {
  try {
    const { id } = req.params;
    const { name, folderId } = req.body;
    const ownerId = req.user.id;

    const existing = await query(
      "SELECT * FROM files WHERE id = $1 AND owner_id = $2 AND is_deleted = false",
      [id, ownerId]
    );
    if (existing.rowCount === 0) throw Errors.notFound("File");

    if (folderId) {
      const folder = await query(
        "SELECT id FROM folders WHERE id = $1 AND owner_id = $2 AND is_deleted = false",
        [folderId, ownerId]
      );
      if (folder.rowCount === 0) throw Errors.notFound("Target folder");
    }

    const result = await query(
      `UPDATE files SET
         name = coalesce($1, name),
         folder_id = CASE WHEN $2::boolean THEN $3::uuid ELSE folder_id END,
         updated_at = now()
       WHERE id = $4
       RETURNING *`,
      [name ?? null, folderId !== undefined, folderId ?? null, id]
    );

    res.json(toFileResponse(result.rows[0]));
  } catch (err) {
    next(err);
  }
}

/** POST /api/files/:id/trash — soft delete (move to Trash) */
export async function trashFile(req, res, next) {
  try {
    const { id } = req.params;
    const result = await query(
      "UPDATE files SET is_deleted = true, deleted_at = now() WHERE id = $1 AND owner_id = $2 AND is_deleted = false RETURNING id",
      [id, req.user.id]
    );
    if (result.rowCount === 0) throw Errors.notFound("File");

    await query(
      `INSERT INTO activities (actor_id, action, resource_type, resource_id)
       VALUES ($1, 'delete', 'file', $2)`,
      [req.user.id, id]
    );

    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

/** POST /api/files/:id/restore — restore from Trash */
export async function restoreFile(req, res, next) {
  try {
    const { id } = req.params;
    const result = await query(
      "UPDATE files SET is_deleted = false, deleted_at = null WHERE id = $1 AND owner_id = $2 RETURNING *",
      [id, req.user.id]
    );
    if (result.rowCount === 0) throw Errors.notFound("File");

    await query(
      `INSERT INTO activities (actor_id, action, resource_type, resource_id)
       VALUES ($1, 'restore', 'file', $2)`,
      [req.user.id, id]
    );

    res.json(toFileResponse(result.rows[0]));
  } catch (err) {
    next(err);
  }
}

/** GET /api/files?folderId=... — list files in a folder (root if omitted) */
export async function listFiles(req, res, next) {
  try {
    const folderId = req.query.folderId || null;
    const result = await query(
      "SELECT * FROM files WHERE owner_id = $1 AND is_deleted = false AND coalesce(folder_id::text,'') = coalesce($2::text,'') ORDER BY name",
      [req.user.id, folderId]
    );
    res.json(result.rows.map(toFileResponse));
  } catch (err) {
    next(err);
  }
}