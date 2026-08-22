import dotenv from "dotenv";
dotenv.config();

export const env = {
  port: process.env.PORT || 8080,
  nodeEnv: process.env.NODE_ENV || "development",
  databaseUrl: process.env.DATABASE_URL,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  supabaseStorageBucket: process.env.SUPABASE_STORAGE_BUCKET || "drive",
  jwtSecret: process.env.JWT_SECRET,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:3000",
};

// Fail fast if critical env vars are missing
const required = ["databaseUrl", "jwtSecret", "jwtRefreshSecret", "supabaseUrl", "supabaseServiceRoleKey"];
for (const key of required) {
  if (!env[key]) {
    throw new Error(`Missing required environment variable for: ${key}`);
  }
}