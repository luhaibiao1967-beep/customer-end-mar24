import { createClient } from "@supabase/supabase-js";

// Default to "cloud" for production (Vercel). Use VITE_SUPABASE_MODE=local for local dev with Supabase CLI.
const mode = import.meta.env.VITE_SUPABASE_MODE || "cloud";
const localUrl = import.meta.env.VITE_SUPABASE_URL_LOCAL || "/supabase";
const cloudUrl = import.meta.env.VITE_SUPABASE_URL_CLOUD || "https://jzdnvdebwmuebjbergsp.supabase.co";
const rawSupabaseUrl = mode === "local" ? localUrl : cloudUrl;
const supabaseUrl = rawSupabaseUrl.startsWith("/")
	? `${window.location.origin}${rawSupabaseUrl}`
	: rawSupabaseUrl;
const localAnon = import.meta.env.VITE_SUPABASE_ANON_KEY_LOCAL || import.meta.env.VITE_SUPABASE_ANON_KEY;
const cloudAnon = import.meta.env.VITE_SUPABASE_ANON_KEY_CLOUD || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6ZG52ZGVid211ZWJqYmVyZ3NwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgyODAxNTksImV4cCI6MjA4Mzg1NjE1OX0.uE2V99SFMeiE3NzzR8aoXDJeUdVuG6jU8ghkib1acrQ";
const supabaseAnonKey = mode === "local" ? (localAnon || cloudAnon) : cloudAnon;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/** 调试用：当前实际连接的 Supabase 项目 */
export const SUPABASE_DEBUG = {
  url: supabaseUrl,
  projectRef: supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1] ?? 'unknown',
};
