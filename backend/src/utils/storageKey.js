import { randomUUID } from "crypto";

/**
 * Builds a collision-free storage path:
 * tenants/{ownerId}/files/{uuid}-{sanitized-filename}
 */
export function buildStorageKey(ownerId, originalName) {
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `tenants/${ownerId}/files/${randomUUID()}-${safeName}`;
}