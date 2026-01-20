// src/lib/auth.ts
import { supabase } from "./supabase";

function isSellerPath() {
  if (typeof window === "undefined") return false;
  const p = window.location?.pathname ?? "";
  return p === "/seller" || p.startsWith("/seller/");
}

/**
 * ✅ Now: only ensures profile IF a real session exists.
 * ❌ No anonymous sign-in anymore.
 */
export async function ensureSessionAndProfile() {
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;

  if (!user) {
    // No session — caller decides what UI to show (AuthWall).
    return;
  }

  const { data: existing, error: selErr } = await supabase
    .from("profiles")
    .select("id, role, display_name")
    .eq("id", user.id)
    .maybeSingle();

  if (selErr) throw selErr;

  if (!existing) {
    const { error: insErr } = await supabase.from("profiles").insert({
      id: user.id,
      role: isSellerPath() ? "seller" : "user",
      display_name: null,
    });
    if (insErr) throw insErr;
  } else {
    // one-way upgrade to seller if user enters seller area
    if (isSellerPath() && existing.role !== "seller") {
      await supabase.from("profiles").update({ role: "seller" }).eq("id", user.id);
    }
  }
}

export async function signInWithGoogle() {
  // Preserve current path so seller login returns to /seller (not just /)
  const redirectTo = window.location.origin + window.location.pathname;

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });
  if (error) throw error;
}

export async function signOut() {
  await supabase.auth.signOut();
}
