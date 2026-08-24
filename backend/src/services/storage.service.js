import { supabaseAdmin } from "../config/supabase.js";
import { env } from "../config/env.js";
import { AppError } from "../utils/AppError.js";

const BUCKET = env.supabaseStorageBucket;

/** Uploads a file buffer (from Multer memory storage) to Supabase Storage. */
export async function uploadObject(storageKey, buffer, mimeType) {
  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(storageKey, buffer, { contentType: mimeType, upsert: false });

  if (error) {
    throw new AppError(500, "STORAGE_UPLOAD_FAILED", error.message);
  }
}

/** Returns a short-lived signed URL for downloading a private object. */
export async function getSignedDownloadUrl(storageKey, expiresInSeconds = 900) {
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(storageKey, expiresInSeconds);

  if (error) {
    throw new AppError(500, "STORAGE_SIGN_FAILED", error.message);
  }
  return data.signedUrl;
}

/** Returns a signed URL the client can PUT/upload bytes to directly (large files). */
export async function getSignedUploadUrl(storageKey) {
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUploadUrl(storageKey);

  if (error) {
    throw new AppError(500, "STORAGE_SIGN_FAILED", error.message);
  }
  return data; // { signedUrl, token, path }
}

export async function deleteObject(storageKey) {
  const { error } = await supabaseAdmin.storage.from(BUCKET).remove([storageKey]);
  if (error) {
    throw new AppError(500, "STORAGE_DELETE_FAILED", error.message);
  }
}