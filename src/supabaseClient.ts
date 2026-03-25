import { createClient } from "@supabase/supabase-js";

// No hardcoded URL/keys — set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (see .env.example).
// VITE_SUPABASE_MODE=local uses Vite proxy /supabase → 127.0.0.1:54321 when developing with Supabase CLI.
const mode = import.meta.env.VITE_SUPABASE_MODE || "cloud";
const localUrl = import.meta.env.VITE_SUPABASE_URL_LOCAL || "/supabase";
const cloudUrl =
	import.meta.env.VITE_SUPABASE_URL_CLOUD ||
	import.meta.env.VITE_SUPABASE_URL ||
	import.meta.env.NEXT_PUBLIC_SUPABASE_URL ||
	"";
const rawSupabaseUrl = mode === "local" ? localUrl : cloudUrl;
const supabaseUrl = rawSupabaseUrl.startsWith("/")
	? `${window.location.origin}${rawSupabaseUrl}`
	: rawSupabaseUrl;
const localAnon =
	import.meta.env.VITE_SUPABASE_ANON_KEY_LOCAL || import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const cloudAnon =
	import.meta.env.VITE_SUPABASE_ANON_KEY_CLOUD ||
	import.meta.env.VITE_SUPABASE_ANON_KEY ||
	import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
	import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
	"";
const supabaseAnonKey = mode === "local" ? localAnon || cloudAnon : cloudAnon;

if (import.meta.env.DEV) {
	const missingCloud = mode === "cloud" && (!cloudUrl || !cloudAnon);
	const missingLocal = mode === "local" && !supabaseAnonKey;
	if (missingCloud || missingLocal) {
		console.error(
			"[supabaseClient] Missing Supabase env. Copy .env.example → .env.local and set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (or NEXT_PUBLIC_* equivalents)."
		);
	}
	if (mode === "cloud" && cloudAnon.startsWith("sb_publishable_")) {
		console.warn(
			"[supabaseClient] Publishable keys (sb_publishable_*) often return 401 on Edge Functions. Use the Legacy anon JWT (eyJ...) from Dashboard → API → Legacy API keys."
		);
	}
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Unique storageKey prevents conflict with ProjectA (app.vividaqua.id)
    // which shares the same origin and localStorage.
    storageKey: 'customer-portal-auth',
    persistSession: false,
  },
});
