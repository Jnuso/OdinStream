import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Capture callback failures before the auth client can process the URL.
const fragment = new URLSearchParams(window.location.hash.slice(1));
const query = new URLSearchParams(window.location.search);
export const authCallbackError = fragment.has("error_description") || query.has("error_description")
  ? "This sign-in, confirmation, or recovery link is invalid or has expired. Request a new link."
  : null;

export const supabase = url && key ? createClient(url, key) : null;
