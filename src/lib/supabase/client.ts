"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

// Accounts are optional: with no keys configured the app runs anonymously
// and every sign-in affordance stays hidden.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const accountsEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient | null {
  if (!accountsEnabled) return null;
  if (!client) client = createBrowserClient(SUPABASE_URL!, SUPABASE_ANON_KEY!);
  return client;
}
