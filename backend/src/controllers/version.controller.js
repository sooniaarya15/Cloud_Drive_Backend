import { query } from "../db/pool.js";
import { buildStorageKey } from "../utils/storageKey.js";
import { uploadObject, getSignedDownloadUrl } from "../services/storage.service.js";
import { Errors } from "../utils/AppError.js";

/** POST /api/files/:id/versions — upload a new version of an existing file (multipart, field "file") */
export async function uploadNewVersion(req, res, next) {
  try {
    if (!req.file) throw Errors.validation("No file provided");
    const { id } = req.params;
    const ownerId = req.user.id;

    const fileResult = await query(
      "SELECT * FROM files WHERE id = $1 AND owner_id = $2 AND is_deleted = false",
      [id, ownerId]
    );
    if (fileResult.rowCount === 0) throw Errors.notFound("File");
    const file = fileResult.rows[0];

    // Archive the CURRENT storage object as a version row before overwriting the pointer
    const lastVersion = await query(
      "SELECT COALESCE(MAX(version_number), 0) AS max FROM file_versions WHERE file_id = $1",
      [id]
    );
    const nextVersionNumber = Number(lastVersion.rows[0].max) + 1;

    await query(
      `INSERT INTO file_versions (file_id, version_number, storage_key, size_bytes, checksum)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, nextVersionNumber, file.storage_key, file.size_bytes, file.checksum]
    );

    // Upload the new bytes under a fresh key, then repoint the file row to it
    const newStorageKey = buildStorageKey(ownerId, req.file.originalname);
    await uploadObject(newStorageKey, req.file.buffer, req.file.mimetype);

    const sizeDelta = req.file.size - file.size_bytes;

    const updated = await query(
      `UPDATE files SET storage_key = $1, size_bytes = $2, mime_type = $3, updated_at = now()
       WHERE id = $4 RETURNING *`,
      [newStorageKey, req.file.size, req.file.mimetype, id]
    );

    await query(
      "UPDATE users SET storage_used_bytes = storage_used_bytes + $1 WHERE id = $2",
      [sizeDelta, ownerId]
    );

    res.status(201).json({
      file: {
        id: updated.rows[0].id,
        name: updated.rows[0].name,
        sizeBytes: Number(updated.rows[0].size_bytes),
        updatedAt: updated.rows[0].updated_at,
      },
      newVersionNumber: nextVersionNumber,
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/files/:id/versions — list version history */
export async function listVersions(req, res, next) {
  try {
    const { id } = req.params;
    const fileCheck = await query("SELECT id FROM files WHERE id = $1 AND owner_id = $2", [id, req.user.id]);
    if (fileCheck.rowCount === 0) throw Errors.notFound("File");

    const versions = await query(
      "SELECT * FROM file_versions WHERE file_id = $1 ORDER BY version_number DESC",
      [id]
    );

    res.json(
      versions.rows.map((v) => ({
        id: v.id,
        versionNumber: v.version_number,
        sizeBytes: Number(v.size_bytes),
        createdAt: v.created_at,
      }))
    );
  } catch (err) {
    next(err);
  }
}

/** POST /api/files/:id/versions/:versionId/revert — make an old version the current one */
export async function revertToVersion(req, res, next) {
  try {
    const { id, versionId } = req.params;
    const ownerId = req.user.id;

    const [fileResult, versionResult] = await Promise.all([
      query("SELECT * FROM files WHERE id = $1 AND owner_id = $2", [id, ownerId]),
      query("SELECT * FROM file_versions WHERE id = $1 AND file_id = $2", [versionId, id]),
    ]);
    if (fileResult.rowCount === 0) throw Errors.notFound("File");
    if (versionResult.rowCount === 0) throw Errors.notFound("Version");

    const file = fileResult.rows[0];
    const version = versionResult.rows[0];

    // Archive current state as a new version, then point the file back at the old object
    const lastVersion = await query(
      "SELECT COALESCE(MAX(version_number), 0) AS max FROM file_versions WHERE file_id = $1",
      [id]
    );
    const nextVersionNumber = Number(lastVersion.rows[0].max) + 1;

    await query(
      `INSERT INTO file_versions (file_id, version_number, storage_key, size_bytes, checksum)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, nextVersionNumber, file.storage_key, file.size_bytes, file.checksum]
    );

    const sizeDelta = version.size_bytes - file.size_bytes;

    const updated = await query(
      `UPDATE files SET storage_key = $1, size_bytes = $2, updated_at = now() WHERE id = $3 RETURNING *`,
      [version.storage_key, version.size_bytes, id]
    );

    await query(
      "UPDATE users SET storage_used_bytes = storage_used_bytes + $1 WHERE id = $2",
      [sizeDelta, ownerId]
    );

    res.json({
      id: updated.rows[0].id,
      name: updated.rows[0].name,
      sizeBytes: Number(updated.rows[0].size_bytes),
    });
  } catch (err) {
    next(err);
  }
}