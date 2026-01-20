import { useEffect, useState } from "react";
import { Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { supabase } from "./lib/supabase";
import { ensureSessionAndProfile, signInWithGoogle, signOut } from "./lib/auth";

import AskPage from "./pages/AskPage";
import BuyerThreadsPage from "./pages/BuyerThreadsPage";
import ThreadDetailPage from "./pages/ThreadDetailPage";
import BuyerSettingsPage from "./pages/BuyerSettingsPage";

import SellerThreadsPage from "./pages/SellerThreadsPage";
import SellerFeedPage from "./pages/SellerFeedPage";
import SellerThreadDetailPage from "./pages/SellerThreadDetailPage";
import SellerOrderPage from "./pages/SellerOrderPage";
import SellerSettingsPage from "./pages/SellerSettingsPage";

import { Settings, LogOut } from "lucide-react";

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
    <div className="min-h-screen h-screen w-full bg-white overflow-hidden">
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
            <button
              onClick={() => nav(isSeller ? "/seller" : "/")}
              className="flex items-center gap-3"
            >
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
              >
                <Settings size={18} className="text-white" />
              </button>

              <button
                onClick={async () => {
                  await signOut();
                  nav("/");
                }}
                className="h-10 w-10 rounded-full bg-white/15 flex items-center justify-center"
              >
                <LogOut size={18} className="text-white" />
              </button>
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
  return (
    <div
      className="
        h-screen
        w-full
        flex
        flex-col
        bg-cover
        bg-center
        bg-no-repeat
        overflow-hidden
      "
      style={{ backgroundImage: "url(/splash.png)" }}
    >
      <div
        className="
          flex
          flex-col
          justify-between
          flex-1
          px-6
          pt-[env(safe-area-inset-top)]
          pb-[env(safe-area-inset-bottom)]
        "
      >
        {/* Logo */}
        <div className="pt-10 flex justify-center">
          <div className="flex items-center gap-3">
            <img src="/white_logo.svg" alt="Veda" className="h-12 w-12" />
            <span className="text-white text-2xl font-semibold tracking-tight">
              Veda
            </span>
          </div>
        </div>

        {/* CTA */}
        <div className="pb-6">
          <button
            onClick={() => signInWithGoogle().catch(console.error)}
            className="
              w-full
              rounded-full
              bg-white
              text-black
              py-4
              text-base
              font-medium
              flex
              items-center
              justify-center
              gap-3
              shadow-lg
              active:scale-[0.98]
              transition
            "
          >
            <GoogleGlyph />
            Continue with Google
          </button>

          <p className="mt-3 text-center text-xs text-white/80">
            Sign in required to place orders, accept offers, or chat.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ============================== GOOGLE ICON ============================== */

function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.6 20H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.7-.4-4z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 18.9 12 24 12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6 29.3 4 24 4c-7.7 0-14.3 4.3-17.7 10.7z"/>
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-1.7 1.2-4.2 2-7.2 2-5.2 0-9.6-3.3-11.3-8l-6.5 5c3.4 6.4 10.1 11.4 17.8 11.4z"/>
      <path fill="#1976D2" d="M43.6 20H42V20H24v8h11.3c-.8 2.3-2.2 4.1-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.7-.4-4z"/>
    </svg>
  );
}
