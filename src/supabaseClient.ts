// src/supabaseClient.ts
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || "").trim();
const supabaseAnonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim();

if (!supabaseUrl || !supabaseAnonKey) {
  // This client should not be used for sales booking/finance anymore, but other pages/components
  // may still rely on it. Fail fast so misconfig is obvious in dev/preview.
  // (Vite will also inline env vars at build time.)
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Set them in .env (local) or Netlify env vars."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
