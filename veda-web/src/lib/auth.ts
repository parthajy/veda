// src/lib/auth.ts
import { supabase } from "./supabase";

function isSellerPath() {
  if (typeof window === "undefined") return false;
  const p = window.location?.pathname ?? "";
  return p === "/seller" || p.startsWith("/seller/");
}

function normalizePhoneIN(raw: string) {
  const s = (raw || "").trim();
  if (!s) return "";

  // keep digits only
  const digits = s.replace(/\D/g, "");
  if (!digits) return "";

  // 10-digit local -> +91
  if (digits.length === 10) return `+91${digits}`;

  // already includes country code like 91xxxxxxxxxx
  if (digits.length >= 11 && digits.startsWith("91")) return `+${digits}`;

  // fallback: prefix +
  return `+${digits}`;
}

export async function ensureSessionAndProfile() {
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user) return;

  const userPhone = (user.phone ?? "").trim() || null;

  const { data: existing, error } = await supabase
    .from("profiles")
    .select("id, role, display_name, phone")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw error;

  if (!existing) {
    const { error: insertErr } = await supabase.from("profiles").insert({
      id: user.id,
      role: isSellerPath() ? "seller" : "user",
      display_name: null,
      phone: userPhone,
    });
    if (insertErr) throw insertErr;
  } else {
    // Promote to seller role if they enter seller surface
    if (isSellerPath() && existing.role !== "seller") {
      const { error: updErr } = await supabase
        .from("profiles")
        .update({ role: "seller" })
        .eq("id", user.id);
      if (updErr) throw updErr;
    }

    // Keep verified phone synced (no manual typing required)
    if (userPhone && existing.phone !== userPhone) {
      await supabase.from("profiles").update({ phone: userPhone }).eq("id", user.id);
    }
  }
}

export async function requestPhoneOtp(rawPhone: string) {
  const phone = normalizePhoneIN(rawPhone);
  if (!phone) throw new Error("Enter a valid phone number");

  const { error } = await supabase.auth.signInWithOtp({
    phone,
    options: { channel: "sms" },
  });

  if (error) throw error;
  return phone;
}

export async function verifyPhoneOtp(phone: string, code: string) {
  const token = (code || "").trim();
  if (!token) throw new Error("Enter OTP");

  const { error } = await supabase.auth.verifyOtp({
    phone,
    token,
    type: "sms",
  });

  if (error) throw error;

  await ensureSessionAndProfile();
}

export async function signOut() {
  await supabase.auth.signOut();
}
