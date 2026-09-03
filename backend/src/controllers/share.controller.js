import { z } from "zod";
import crypto from "crypto";
import { query } from "../db/pool.js";
import { hashPassword, comparePassword } from "../utils/password.js";
import { Errors } from "../utils/AppError.js";
import { getSignedDownloadUrl } from "../services/storage.service.js";

export const createShareSchema = z.object({
  resourceType: z.enum(["file", "folder"]),
  resourceId: z.string().uuid(),
  granteeEmail: z.string().email(),
  role: z.enum(["viewer", "editor"]),
});

export const createLinkShareSchema = z.object({
  resourceType: z.enum(["file", "folder"]),
  resourceId: z.string().uuid(),
  expiresAt: z.string().datetime().nullable().optional(),
  password: z.string().min(4).nullable().optional(),
});

async function assertOwnership(resourceType, resourceId, ownerId) {
  const table = resourceType === "file" ? "files" : "folders";
  const result = await query(
    `SELECT id FROM ${table} WHERE id = $1 AND owner_id = $2 AND is_deleted = false`,
    [resourceId, ownerId]
  );
  if (result.rowCount === 0) throw Errors.notFound(resourceType === "file" ? "File" : "Folder");
}

/**
 * POST /api/shares — grant a specific user (or pending invite, if they haven't
 * registered yet) Viewer/Editor access.
 */
export async function createShare(req, res, next) {
  try {
    const { resourceType, resourceId, granteeEmail, role } = req.body;
    const ownerId = req.user.id;
    const normalizedEmail = granteeEmail.trim().toLowerCase();

    await assertOwnership(resourceType, resourceId, ownerId);

    const grantee = await query("SELECT id FROM users WHERE email = $1", [normalizedEmail]);
    const granteeId = grantee.rowCount > 0 ? grantee.rows[0].id : null;

    if (granteeId === ownerId) throw Errors.validation("You already own this item");

    const result = await query(
      `INSERT INTO shares (resource_type, resource_id, grantee_user_id, grantee_email, role, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (resource_type, resource_id, COALESCE(grantee_email, ''))
       DO UPDATE SET role = EXCLUDED.role, grantee_user_id = EXCLUDED.grantee_user_id
       RETURNING *`,
      [resourceType, resourceId, granteeId, normalizedEmail, role, ownerId]
    );

    await query(
      `INSERT INTO activities (actor_id, action, resource_type, resource_id, context)
       VALUES ($1, 'share', $2, $3, $4)`,
      [ownerId, resourceType, resourceId, JSON.stringify({ granteeEmail: normalizedEmail, role })]
    );

    res.status(201).json({
      ...result.rows[0],
      pending: granteeId === null, // true = invited user hasn't signed up yet
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/shares/:resourceType/:resourceId — list who has access (registered + pending) */
export async function listShares(req, res, next) {
  try {
    const { resourceType, resourceId } = req.params;
    await assertOwnership(resourceType, resourceId, req.user.id);

    const result = await query(
      `SELECT s.id, s.role, s.created_at, s.grantee_email,
              u.id AS user_id, u.name, u.email, u.image_url
       FROM shares s
       LEFT JOIN users u ON u.id = s.grantee_user_id
       WHERE s.resource_type = $1 AND s.resource_id = $2
       ORDER BY s.created_at DESC`,
      [resourceType, resourceId]
    );

    res.json(
      result.rows.map((r) => ({
        shareId: r.id,
        role: r.role,
        createdAt: r.created_at,
        pending: !r.user_id,
        user: r.user_id
          ? { id: r.user_id, name: r.name, email: r.email, imageUrl: r.image_url }
          : { email: r.grantee_email, name: null },
      }))
    );
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/shares/:id — revoke access (registered or pending) */
export async function deleteShare(req, res, next) {
  try {
    const { id } = req.params;
    const result = await query(
      "DELETE FROM shares WHERE id = $1 AND created_by = $2 RETURNING id",
      [id, req.user.id]
    );
    if (result.rowCount === 0) throw Errors.notFound("Share");
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

/** GET /api/shares/shared-with-me — items shared with the current user */
export async function listSharedWithMe(req, res, next) {
  try {
    const shares = await query(
      "SELECT * FROM shares WHERE grantee_user_id = $1 ORDER BY created_at DESC",
      [req.user.id]
    );

    const fileIds = shares.rows.filter((s) => s.resource_type === "file").map((s) => s.resource_id);
    const folderIds = shares.rows.filter((s) => s.resource_type === "folder").map((s) => s.resource_id);

    const [files, folders] = await Promise.all([
      fileIds.length
        ? query("SELECT * FROM files WHERE id = ANY($1::uuid[]) AND is_deleted = false", [fileIds])
        : { rows: [] },
      folderIds.length
        ? query("SELECT * FROM folders WHERE id = ANY($1::uuid[]) AND is_deleted = false", [folderIds])
        : { rows: [] },
    ]);

    res.json({ files: files.rows, folders: folders.rows });
  } catch (err) {
    next(err);
  }
}

// ---------------- Public Links ----------------

export async function createLinkShare(req, res, next) {
  try {
    const { resourceType, resourceId, expiresAt, password } = req.body;
    const ownerId = req.user.id;

    await assertOwnership(resourceType, resourceId, ownerId);

    const token = crypto.randomBytes(24).toString("hex");
    const passwordHash = password ? await hashPassword(password) : null;

    const result = await query(
      `INSERT INTO link_shares (resource_type, resource_id, token, password_hash, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [resourceType, resourceId, token, passwordHash, expiresAt || null, ownerId]
    );

    res.status(201).json({
      id: result.rows[0].id,
      token,
      shareUrl: `${process.env.CORS_ORIGIN}/share/${token}`,
      expiresAt: result.rows[0].expires_at,
      hasPassword: !!passwordHash,
    });
  } catch (err) {
    next(err);
  }
}

export async function resolveLink(req, res, next) {
  try {
    const { token } = req.params;
    const { password } = req.query;

    const result = await query("SELECT * FROM link_shares WHERE token = $1", [token]);
    if (result.rowCount === 0) throw Errors.notFound("Link");

    const link = result.rows[0];

    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      throw Errors.validation("This link has expired");
    }

    if (link.password_hash) {
      const valid = await comparePassword(password, link.password_hash);
      if (!valid) throw Errors.forbidden("Incorrect or missing password");
    }

    if (link.resource_type === "file") {
      const file = await query("SELECT * FROM files WHERE id = $1 AND is_deleted = false", [link.resource_id]);
      if (file.rowCount === 0) throw Errors.notFound("File");

      const signedUrl = await getSignedDownloadUrl(file.rows[0].storage_key);
      return res.json({
        resourceType: "file",
        file: {
          id: file.rows[0].id,
          name: file.rows[0].name,
          mimeType: file.rows[0].mime_type,
          sizeBytes: Number(file.rows[0].size_bytes),
        },
        signedUrl,
        role: link.role,
      });
    } else {
      const folder = await query("SELECT * FROM folders WHERE id = $1 AND is_deleted = false", [link.resource_id]);
      if (folder.rowCount === 0) throw Errors.notFound("Folder");

      const children = await query(
        "SELECT * FROM files WHERE folder_id = $1 AND is_deleted = false ORDER BY name",
        [link.resource_id]
      );

      return res.json({
        resourceType: "folder",
        folder: { id: folder.rows[0].id, name: folder.rows[0].name },
        files: children.rows.map((f) => ({ id: f.id, name: f.name, sizeBytes: Number(f.size_bytes) })),
        role: link.role,
      });
    }
  } catch (err) {
    next(err);
  }
}

export async function deleteLinkShare(req, res, next) {
  try {
    const { id } = req.params;
    const result = await query(
      "DELETE FROM link_shares WHERE id = $1 AND created_by = $2 RETURNING id",
      [id, req.user.id]
    );
    if (result.rowCount === 0) throw Errors.notFound("Link");
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

/**
 * Called from register() right after a new user is created — links any
 * pending shares that were invited to this email before they signed up.
 */
export async function linkPendingShares(userId, email) {
  await query(
    "UPDATE shares SET grantee_user_id = $1 WHERE grantee_email = $2 AND grantee_user_id IS NULL",
    [userId, email.toLowerCase()]
  );
}