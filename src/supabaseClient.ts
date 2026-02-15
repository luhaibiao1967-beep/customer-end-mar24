import { createClient } from "@supabase/supabase-js";

// Default to "cloud" for production (Vercel). Use VITE_SUPABASE_MODE=local for local dev with Supabase CLI.
const mode = import.meta.env.VITE_SUPABASE_MODE || "cloud";
const localUrl = import.meta.env.VITE_SUPABASE_URL_LOCAL || "/supabase";
const cloudUrl = import.meta.env.VITE_SUPABASE_URL_CLOUD || "https://zpxdxyjzseuvdhxbuqpc.supabase.co";
const rawSupabaseUrl = mode === "local" ? localUrl : cloudUrl;
const supabaseUrl = rawSupabaseUrl.startsWith("/")
	? `${window.location.origin}${rawSupabaseUrl}`
	: rawSupabaseUrl;
const localAnon = import.meta.env.VITE_SUPABASE_ANON_KEY_LOCAL || import.meta.env.VITE_SUPABASE_ANON_KEY;
const cloudAnon = import.meta.env.VITE_SUPABASE_ANON_KEY_CLOUD || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpweGR4eWp6c2V1dmRoeGJ1cXBjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MDk5NzcsImV4cCI6MjA4NTM4NTk3N30.kXzhMg7q_CNsmG_6uF0EPB2asACyfgz-B_ocBHI3lQM";
const supabaseAnonKey = mode === "local" ? (localAnon || cloudAnon) : cloudAnon;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
