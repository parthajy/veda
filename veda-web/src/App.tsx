// /Users/partha/Desktop/veda/veda-web/src/App.tsx
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

import { Settings, LogOut, Plus, List, Store } from "lucide-react";

export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      await ensureSessionAndProfile();
      setReady(true);
    })().catch(console.error);
  }, []);

  if (!ready) return <div className="p-6 text-sm">Loading Veda…</div>;

  return (
    <div className="min-h-screen bg-white">
      <TopBar />

      <Routes>
        {/* ---------------- BUYER ---------------- */}
        <Route path="/" element={<BuyerThreadsPage />} />
        <Route path="/ask" element={<AskPage />} />
        <Route path="/t/:requestId" element={<ThreadDetailPage />} />
        <Route path="/settings" element={<BuyerSettingsPage />} />

        {/* ---------------- SELLER ---------------- */}
        <Route path="/seller" element={<SellerThreadsPage />} />
        <Route path="/seller/feed" element={<SellerFeedPage />} />
        <Route path="/seller/t/:requestId" element={<SellerThreadDetailPage />} />
        <Route path="/seller/order/:orderId" element={<SellerOrderPage />} />
        <Route path="/seller/settings" element={<SellerSettingsPage />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

/* -------------------------------- UI -------------------------------- */

function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303C33.673 32.658 29.2 36 24 36c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.957 3.043l5.657-5.657C34.018 6.053 29.268 4 24 4 12.954 4 4 12.954 4 24s8.954 20 20 20 20-8.954 20-20c0-1.341-.138-2.65-.389-3.917z" />
      <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.957 3.043l5.657-5.657C34.018 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.197l-6.191-5.238C29.176 35.091 26.715 36 24 36c-5.179 0-9.637-3.317-11.276-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.789 2.242-2.231 4.141-4.084 5.565l.003-.002 6.191 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
    </svg>
  );
}

function TopBar() {
  const nav = useNavigate();
  const loc = useLocation();

  const isSeller = loc.pathname === "/seller" || loc.pathname.startsWith("/seller/");
  const settingsPath = isSeller ? "/seller/settings" : "/settings";
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    (async () => {
      const u = (await supabase.auth.getUser()).data.user;
      setUserEmail(u?.email ?? null);
      setChecking(false);
    })().catch(() => setChecking(false));
  }, []);

  const isAuthed = !!userEmail;

  return (
    <div className="sticky top-0 z-20 bg-white">
      <div className="border-b border-zinc-200/70">
        <div className="mx-auto max-w-md px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            {/* Brand */}
            <button
              onClick={() => nav(isSeller ? "/seller" : "/")}
              className="flex items-center gap-3 min-w-0 active:scale-[0.99] transition"
              title="Home"
            >
              <img src="/logo.svg" alt="Veda" className="h-10 w-10" />
              <div className="min-w-0 leading-tight text-left">
                <div className="flex items-center gap-2">
                  <div className="text-[16px] font-semibold text-zinc-900">Veda</div>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "#2fa8d7" }} />
                </div>
                <div className="text-[12px] text-zinc-500">{isSeller ? "Seller" : "Buyer"}</div>
              </div>
            </button>

            {/* Actions */}
            <div className="flex items-center gap-3 shrink-0">
              {!isAuthed ? (
  <>
    {/* Mode switch (ALWAYS visible) */}
    <button
      className="rounded-full border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-800"
      onClick={() => nav(isSeller ? "/" : "/seller")}
      title={isSeller ? "Switch to Buyer" : "Switch to Seller"}
    >
      {isSeller ? "Buyer" : "Seller"}
    </button>

    {/* Google */}
    <button
      className="h-10 w-10 flex items-center justify-center disabled:opacity-60 active:scale-[0.98] transition"
      disabled={checking}
      onClick={() => signInWithGoogle().catch(console.error)}
      title="Continue with Google"
      aria-label="Continue with Google"
    >
      <GoogleGlyph />
    </button>

    {/* Settings */}
    <button
      className="h-10 w-10 flex items-center justify-center active:scale-[0.98] transition"
      onClick={() => nav(settingsPath)}
      title="Settings"
      aria-label="Settings"
    >
      <Settings size={20} className="text-zinc-700" />
    </button>
  </>
) : (
                <>
                  {/* Mode switch */}
                  <button
                    className="rounded-full border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-800"
                    onClick={() => nav(isSeller ? "/" : "/seller")}
                  >
                    {isSeller ? "Buyer" : "Seller"}
                  </button>

                  {isSeller ? (
                    <div className="hidden sm:flex items-center gap-2">
                      <button
                        className="rounded-full border border-zinc-200 bg-white px-3 py-2 text-xs"
                        onClick={() => nav("/seller")}
                      >
                        <List size={16} />
                      </button>
                      <button
                        className="rounded-full px-3 py-2 text-xs font-semibold text-white"
                        style={{ backgroundColor: "#1698cc" }}
                        onClick={() => nav("/seller/feed")}
                      >
                        <Store size={16} />
                      </button>
                    </div>
                  ) : (
                    <button
                      className="rounded-full px-4 py-2 text-xs font-semibold text-white"
                      style={{ backgroundColor: "#2fa8d7" }}
                      onClick={() => nav("/ask")}
                    >
                      <Plus size={16} /> New
                    </button>
                  )}

                  <button
                    className="h-10 w-10 flex items-center justify-center"
                    onClick={async () => {
                      await signOut();
                      setUserEmail(null);
                      nav("/");
                    }}
                  >
                    <LogOut size={20} className="text-zinc-700" />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-zinc-50/60">
        <div className="mx-auto max-w-md px-4">
          <div className="h-2" />
        </div>
      </div>
    </div>
  );
}
