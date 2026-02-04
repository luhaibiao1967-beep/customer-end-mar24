import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://zpxdxyjzseuvdhxbuqpc.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpweGR4eWp6c2V1dmRoeGJ1cXBjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MDk5NzcsImV4cCI6MjA4NTM4NTk3N30.kXzhMg7q_CNsmG_6uF0EPB2asACyfgz-B_ocBHI3lQM"

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
