import { z } from "zod";
import { query } from "../db/pool.js";
import { Errors } from "../utils/AppError.js";

export const createFolderSchema = z.object({
  name: z.string().min(1, "Folder name is required").max(255),
  parentId: z.string().uuid().nullable().optional(),
});

export const updateFolderSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  parentId: z.string().uuid().nullable().optional(),
});

function toFolderResponse(row) {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** POST /api/folders — create a folder (root if parentId is null) */
export async function createFolder(req, res, next) {
  try {
    const { name, parentId } = req.body;
    const ownerId = req.user.id;

    if (parentId) {
      const parent = await query(
        "SELECT id FROM folders WHERE id = $1 AND owner_id = $2 AND is_deleted = false",
        [parentId, ownerId]
      );
      if (parent.rowCount === 0) throw Errors.notFound("Parent folder");
    }

    const existing = await query(
      `SELECT id FROM folders
       WHERE owner_id = $1 AND is_deleted = false AND name = $2
       AND coalesce(parent_id::text, '') = coalesce($3::text, '')`,
      [ownerId, name, parentId || null]
    );
    if (existing.rowCount > 0) {
      throw Errors.validation(`A folder named "${name}" already exists here`);
    }

    const result = await query(
      `INSERT INTO folders (name, owner_id, parent_id)
       VALUES ($1, $2, $3) RETURNING *`,
      [name, ownerId, parentId || null]
    );

    res.status(201).json(toFolderResponse(result.rows[0]));
  } catch (err) {
    next(err);
  }
}

/** GET /api/folders/:id — folder details + its children (subfolders + files) + breadcrumb path */
export async function getFolder(req, res, next) {
  try {
    const { id } = req.params;
    const ownerId = req.user.id;
    const isRoot = id === "root";

    let folder = null;
    if (!isRoot) {
      const result = await query(
        "SELECT * FROM folders WHERE id = $1 AND owner_id = $2 AND is_deleted = false",
        [id, ownerId]
      );
      if (result.rowCount === 0) throw Errors.notFound("Folder");
      folder = result.rows[0];
    }

    const folderIdParam = isRoot ? null : id;

    const [subfolders, files] = await Promise.all([
      query(
        "SELECT * FROM folders WHERE owner_id = $1 AND is_deleted = false AND coalesce(parent_id::text,'') = coalesce($2::text,'') ORDER BY name",
        [ownerId, folderIdParam]
      ),
      query(
        "SELECT * FROM files WHERE owner_id = $1 AND is_deleted = false AND coalesce(folder_id::text,'') = coalesce($2::text,'') ORDER BY name",
        [ownerId, folderIdParam]
      ),
    ]);

    const path = await getBreadcrumbPath(ownerId, folderIdParam);

    res.json({
      folder: folder ? toFolderResponse(folder) : { id: null, name: "My Drive", parentId: null },
      children: {
        folders: subfolders.rows.map(toFolderResponse),
        files: files.rows.map((f) => ({
          id: f.id,
          name: f.name,
          mimeType: f.mime_type,
          sizeBytes: Number(f.size_bytes),
          folderId: f.folder_id,
          starred: f.is_starred,
          createdAt: f.created_at,
        })),
      },
      path,
    });
  } catch (err) {
    next(err);
  }
}

/** Recursive CTE to build breadcrumb trail from root -> current folder */
async function getBreadcrumbPath(ownerId, folderId) {
  if (!folderId) return [{ id: null, name: "My Drive" }];

  const result = await query(
    `WITH RECURSIVE breadcrumb AS (
       SELECT id, name, parent_id, 0 AS depth FROM folders WHERE id = $1 AND owner_id = $2
       UNION ALL
       SELECT f.id, f.name, f.parent_id, b.depth + 1
       FROM folders f
       JOIN breadcrumb b ON f.id = b.parent_id
     )
     SELECT id, name FROM breadcrumb ORDER BY depth DESC`,
    [folderId, ownerId]
  );

  return [{ id: null, name: "My Drive" }, ...result.rows];
}

/** PATCH /api/folders/:id — rename and/or move */
export async function updateFolder(req, res, next) {
  try {
    const { id } = req.params;
    const { name, parentId } = req.body;
    const ownerId = req.user.id;

    const existing = await query(
      "SELECT * FROM folders WHERE id = $1 AND owner_id = $2 AND is_deleted = false",
      [id, ownerId]
    );
    if (existing.rowCount === 0) throw Errors.notFound("Folder");

    if (parentId !== undefined && parentId === id) {
      throw Errors.validation("A folder cannot be moved into itself");
    }

    // Prevent moving a folder into one of its own descendants (would create a cycle)
    if (parentId) {
      const cycle = await query(
        `WITH RECURSIVE descendants AS (
           SELECT id FROM folders WHERE id = $1
           UNION ALL
           SELECT f.id FROM folders f JOIN descendants d ON f.parent_id = d.id
         )
         SELECT id FROM descendants WHERE id = $2`,
        [id, parentId]
      );
      if (cycle.rowCount > 0) {
        throw Errors.validation("Cannot move a folder into its own subfolder");
      }
    }

    const result = await query(
      `UPDATE folders SET
         name = coalesce($1, name),
         parent_id = CASE WHEN $2::boolean THEN $3::uuid ELSE parent_id END,
         updated_at = now()
       WHERE id = $4
       RETURNING *`,
      [name ?? null, parentId !== undefined, parentId ?? null, id]
    );

    res.json(toFolderResponse(result.rows[0]));
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/folders/:id — soft delete (moves to Trash, cascades to children) */
export async function deleteFolder(req, res, next) {
  try {
    const { id } = req.params;
    const ownerId = req.user.id;

    const existing = await query(
      "SELECT id FROM folders WHERE id = $1 AND owner_id = $2 AND is_deleted = false",
      [id, ownerId]
    );
    if (existing.rowCount === 0) throw Errors.notFound("Folder");

    // Soft-delete this folder + all descendant folders + all files inside them
    await query(
      `WITH RECURSIVE descendants AS (
         SELECT id FROM folders WHERE id = $1
         UNION ALL
         SELECT f.id FROM folders f JOIN descendants d ON f.parent_id = d.id
       )
       UPDATE folders SET is_deleted = true, deleted_at = now()
       WHERE id IN (SELECT id FROM descendants)`,
      [id]
    );

    await query(
      `WITH RECURSIVE descendants AS (
         SELECT id FROM folders WHERE id = $1
         UNION ALL
         SELECT f.id FROM folders f JOIN descendants d ON f.parent_id = d.id
       )
       UPDATE files SET is_deleted = true, deleted_at = now()
       WHERE folder_id IN (SELECT id FROM descendants)`,
      [id]
    );

    await query(
      `INSERT INTO activities (actor_id, action, resource_type, resource_id)
       VALUES ($1, 'delete', 'folder', $2)`,
      [ownerId, id]
    );

    res.status(204).send();
  } catch (err) {
    next(err);
  }
}