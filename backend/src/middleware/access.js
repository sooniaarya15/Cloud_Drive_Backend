import { query } from "../db/pool.js";

/**
 * Returns the effective role a user has on a resource:
 * "owner" | "editor" | "viewer" | null (no access)
 */
export async function getEffectiveRole(userId, resourceType, resourceId) {
  const table = resourceType === "file" ? "files" : "folders";

  const owned = await query(`SELECT id FROM ${table} WHERE id = $1 AND owner_id = $2`, [resourceId, userId]);
  if (owned.rowCount > 0) return "owner";

  const shared = await query(
    "SELECT role FROM shares WHERE resource_type = $1 AND resource_id = $2 AND grantee_user_id = $3",
    [resourceType, resourceId, userId]
  );
  if (shared.rowCount > 0) return shared.rows[0].role;

  return null;
}

/** Express middleware factory: requires at least `minRole` on req.params.id */
export function requireRole(resourceType, minRole = "viewer") {
  const rank = { viewer: 1, editor: 2, owner: 3 };

  return async (req, res, next) => {
    const role = await getEffectiveRole(req.user.id, resourceType, req.params.id);
    if (!role || rank[role] < rank[minRole]) {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "Access denied" } });
    }
    req.effectiveRole = role;
    next();
  };
}