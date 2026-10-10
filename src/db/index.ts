import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseSecretKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY environment variables');
}

// Server-side client using the secret key (bypasses RLS). Never ship this key to a browser.
export const db = createClient(supabaseUrl, supabaseSecretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export type DbClient = typeof db;

/** Postgres unique_violation error code */
export const UNIQUE_VIOLATION = '23505';
