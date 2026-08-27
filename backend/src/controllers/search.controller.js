import { query } from "../db/pool.js";

const ALLOWED_SORT = ["name", "created_at", "size_bytes"];
const ALLOWED_ORDER = ["asc", "desc"];

function toFileResponse(row) {
  return {
    id: row.id,
    name: row.name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    folderId: row.folder_id,
    starred: row.is_starred,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * GET /api/search?q=&type=&sort=&order=&limit=&cursor=
 * - q: search text (matched against file name, trigram + full-text)
 * - type: optional mime-type prefix filter, e.g. "image", "application/pdf"
 * - sort: name | created_at | size_bytes  (default: created_at)
 * - order: asc | desc                     (default: desc)
 * - limit: page size (default 20, max 100)
 * - cursor: created_at ISO string of the last item from the previous page (keyset pagination)
 */
export async function search(req, res, next) {
  try {
    const ownerId = req.user.id;
    const q = (req.query.q || "").trim();
    const type = req.query.type;
    const starred = req.query.starred === "true";

    const sort = ALLOWED_SORT.includes(req.query.sort) ? req.query.sort : "created_at";
    const order = ALLOWED_ORDER.includes(req.query.order) ? req.query.order : "desc";
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const cursor = req.query.cursor;

    const conditions = ["owner_id = $1", "is_deleted = false"];
    const params = [ownerId];
    let paramIndex = 2;

    if (q) {
      // Combine trigram similarity (fuzzy/typo-tolerant) with a plain ILIKE fallback
      conditions.push(`(name ILIKE $${paramIndex} OR similarity(name, $${paramIndex + 1}) > 0.2)`);
      params.push(`%${q}%`, q);
      paramIndex += 2;
    }

    if (type) {
      conditions.push(`mime_type ILIKE $${paramIndex}`);
      params.push(`${type}%`);
      paramIndex++;
    }

    if (starred) {
      conditions.push(`is_starred = true`);
    }

    // Keyset pagination: fetch rows "after" the cursor value for stable, fast pagination
    if (cursor) {
      const cmp = order === "desc" ? "<" : ">";
      conditions.push(`${sort} ${cmp} $${paramIndex}`);
      params.push(cursor);
      paramIndex++;
    }

    params.push(limit);

    const sql = `
      SELECT * FROM files
      WHERE ${conditions.join(" AND ")}
      ORDER BY ${sort} ${order}
      LIMIT $${paramIndex}
    `;

    const result = await query(sql, params);
    const items = result.rows.map(toFileResponse);
    const nextCursor = items.length === limit ? result.rows[result.rows.length - 1][sort] : null;

    res.json({ items, nextCursor });
  } catch (err) {
    next(err);
  }
}

/** GET /api/recent — most recently updated files (dashboard "Recent" section) */
export async function recentFiles(req, res, next) {
  try {
    const result = await query(
      "SELECT * FROM files WHERE owner_id = $1 AND is_deleted = false ORDER BY updated_at DESC LIMIT 20",
      [req.user.id]
    );
    res.json(result.rows.map(toFileResponse));
  } catch (err) {
    next(err);
  }
}