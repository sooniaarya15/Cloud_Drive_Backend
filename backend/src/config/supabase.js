import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";

// service_role key = full access, used only server-side (never expose to frontend)
export const supabaseAdmin = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: { persistSession: false },
});
