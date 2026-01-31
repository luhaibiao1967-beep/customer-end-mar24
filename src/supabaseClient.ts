// src/supabaseClient.js
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://zpxdxyjzseuvdhxbuqpc.supabase.co";
const supabaseAnonKey = "sb_publishable_lLi9NyPf-mvxJM5_B7grBA_7zvT5jFp"
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
