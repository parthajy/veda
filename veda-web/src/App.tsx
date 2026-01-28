import { useEffect, useMemo, useState } from "react";
import { Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { supabase } from "./lib/supabase";
import { ensureSessionAndProfile, requestPhoneOtp, verifyPhoneOtp, signOut } from "./lib/auth";

import AskPage from "./pages/AskPage";
import BuyerThreadsPage from "./pages/BuyerThreadsPage";
import ThreadDetailPage from "./pages/ThreadDetailPage";
import BuyerSettingsPage from "./pages/BuyerSettingsPage";

import SellerThreadsPage from "./pages/SellerThreadsPage";
import SellerFeedPage from "./pages/SellerFeedPage";
import SellerThreadDetailPage from "./pages/SellerThreadDetailPage";
import SellerOrderPage from "./pages/SellerOrderPage";
import SellerSettingsPage from "./pages/SellerSettingsPage";

import { Settings, LogOut, User2 } from "lucide-react";

/* ============================== APP ============================== */

export default function App() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    let unsub: null | (() => void) = null;

    (async () => {
      const { data } = await supabase.auth.getSession();
      const hasSession = !!data.session?.user;
      setAuthed(hasSession);

      if (hasSession) {
        await ensureSessionAndProfile();
      }

      setReady(true);

      const { data: sub } = supabase.auth.onAuthStateChange(async (_evt, session) => {
        const ok = !!session?.user;
        setAuthed(ok);
        if (ok) await ensureSessionAndProfile();
      });

      unsub = () => sub.subscription.unsubscribe();
    })().catch(console.error);

    return () => {
      if (unsub) unsub();
    };
  }, []);

  if (!ready) return <div className="p-6 text-sm">Loading Veda…</div>;

  return (
    <div className="min-h-screen w-full bg-white overflow-y-auto">
      {authed && <TopBar />}

      {!authed ? (
        <AuthWall />
      ) : (
        <Routes>
          {/* BUYER */}
          <Route path="/" element={<BuyerThreadsPage />} />
          <Route path="/ask" element={<AskPage />} />
          <Route path="/t/:requestId" element={<ThreadDetailPage />} />
          <Route path="/settings" element={<BuyerSettingsPage />} />

          {/* SELLER */}
          <Route path="/seller" element={<SellerThreadsPage />} />
          <Route path="/seller/feed" element={<SellerFeedPage />} />
          <Route path="/seller/t/:requestId" element={<SellerThreadDetailPage />} />
          <Route path="/seller/order/:orderId" element={<SellerOrderPage />} />
          <Route path="/seller/settings" element={<SellerSettingsPage />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      )}
    </div>
  );
}

/* ============================== TOP BAR ============================== */

function TopBar() {
  const nav = useNavigate();
  const loc = useLocation();

  const isSeller = loc.pathname === "/seller" || loc.pathname.startsWith("/seller/");
  const settingsPath = isSeller ? "/seller/settings" : "/settings";
  const barBg = isSeller ? "bg-emerald-500" : "bg-black";

  return (
    <div className="sticky top-0 z-20">
      <div className={barBg}>
        <div className="mx-auto max-w-md px-4 py-3">
          <div className="flex items-center justify-between">
            <button onClick={() => nav(isSeller ? "/seller" : "/")} className="flex items-center gap-3">
              <img src="/white_logo.svg" className="h-9 w-9" alt="Veda" />
              <div className="text-white">
                <div className="font-semibold text-sm">Veda</div>
                <div className="text-xs opacity-80">{isSeller ? "Seller" : "Buyer"}</div>
              </div>
            </button>

            <div className="flex items-center gap-2">
              <button
                onClick={() => nav(isSeller ? "/" : "/seller")}
                className="rounded-full px-3 py-2 text-xs font-semibold bg-white/15 border border-white/25 text-white"
              >
                {isSeller ? "I'm a customer" : "I'm a business"}
              </button>

              <button
                onClick={() => nav(settingsPath)}
                className="h-10 w-10 rounded-full bg-white/15 flex items-center justify-center"
                title="Settings"
              >
                <Settings size={18} className="text-white" />
              </button>

              <button
                onClick={async () => {
                  await signOut();
                  nav("/");
                }}
                className="h-10 w-10 rounded-full bg-white/15 flex items-center justify-center"
                title="Sign out"
              >
                <LogOut size={18} className="text-white" />
              </button>

              {/* Logged-in indicator */}
              <div
                className="h-10 w-10 rounded-full bg-white/15 border border-white/20 flex items-center justify-center"
                title="Logged in"
              >
                <User2 size={18} className="text-white/90" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white h-2" />
    </div>
  );
}

/* ============================== AUTH WALL ============================== */

function AuthWall() {
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [rawPhone, setRawPhone] = useState("");
  const [normalizedPhone, setNormalizedPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const canSend = useMemo(() => rawPhone.trim().length >= 8 && !busy, [rawPhone, busy]);
  const canVerify = useMemo(() => otp.trim().length >= 4 && !busy, [otp, busy]);

  async function sendOtp() {
    setErr(null);
    setBusy(true);
    try {
      const phone = await requestPhoneOtp(rawPhone);
      setNormalizedPhone(phone);
      setStep("otp");
      setCooldown(30);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to send OTP");
    } finally {
      setBusy(false);
    }
  }

  async function confirmOtp() {
    setErr(null);
    setBusy(true);
    try {
      await verifyPhoneOtp(normalizedPhone, otp);
    } catch (e: any) {
      setErr(e?.message ?? "OTP verification failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="h-screen w-full flex flex-col bg-cover bg-center bg-no-repeat overflow-hidden"
      style={{ backgroundImage: "url(/splash.png)" }}
    >
      <div
        className="flex flex-col justify-between flex-1 px-6 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
      >
        {/* Logo */}
        <div className="pt-10 flex justify-center">
          <div className="flex items-center gap-3">
            <img src="/black_logo.svg" alt="Veda" className="h-12 w-12" />
            <span className="text-black text-2xl font-semibold tracking-tight">Veda</span>
          </div>
        </div>

        {/* CTA */}
        <div className="pb-6">
          <div className="rounded-3xl bg-black/25 border border-white/15 backdrop-blur px-5 py-4 shadow-2xl">
            <div className="text-white font-semibold text-sm">
              {step === "phone" ? "Sign in with phone number" : "Enter OTP"}
            </div>
            <div className="mt-1 text-white/80 text-xs">
              {step === "phone"
                ? "We’ll send a one-time code to verify your number."
                : `Sent to ${normalizedPhone}`}
            </div>

            <div className="mt-4 space-y-3">
              {step === "phone" ? (
                <>
                  <input
                    value={rawPhone}
                    onChange={(e) => setRawPhone(e.target.value)}
                    inputMode="tel"
                    placeholder="Phone number (e.g. 9876543210)"
                    className="w-full rounded-full bg-white text-black py-4 px-5 text-base font-medium shadow-lg outline-none"
                  />

                  <button
                    disabled={!canSend}
                    onClick={sendOtp}
                    className="w-full rounded-full bg-white text-black py-4 text-base font-semibold shadow-lg active:scale-[0.98] transition disabled:opacity-60"
                  >
                    {busy ? "Sending…" : "Send OTP"}
                  </button>
                </>
              ) : (
                <>
                  <input
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    inputMode="numeric"
                    placeholder="OTP"
                    className="w-full rounded-full bg-white text-black py-4 px-5 text-base font-medium shadow-lg outline-none tracking-widest"
                  />

                  <button
                    disabled={!canVerify}
                    onClick={confirmOtp}
                    className="w-full rounded-full bg-white text-black py-4 text-base font-semibold shadow-lg active:scale-[0.98] transition disabled:opacity-60"
                  >
                    {busy ? "Verifying…" : "Verify & Continue"}
                  </button>

                  <div className="flex items-center justify-between gap-3">
                    <button
                      disabled={busy || cooldown > 0}
                      onClick={sendOtp}
                      className="flex-1 rounded-full bg-white/15 border border-white/25 text-white py-3 text-sm font-semibold disabled:opacity-60"
                    >
                      {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend OTP"}
                    </button>

                    <button
                      disabled={busy}
                      onClick={() => {
                        setStep("phone");
                        setOtp("");
                        setNormalizedPhone("");
                        setErr(null);
                      }}
                      className="flex-1 rounded-full bg-white/10 border border-white/15 text-white py-3 text-sm font-semibold"
                    >
                      Change number
                    </button>
                  </div>
                </>
              )}

              {err ? <div className="text-xs text-amber-200">{err}</div> : null}
            </div>
          </div>

          <p className="mt-3 text-center text-xs text-white/80">
            Sign in required to place orders, accept offers, or chat.
          </p>
        </div>
      </div>
    </div>
  );
}
