import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Store, MessageCircle, RefreshCw, ChevronRight } from "lucide-react";

type ThreadRow = {
  request_id: string;
  status: "open" | "locked" | "fulfilled" | "cancelled";
  category: string;
  text: string;
  mode: "now" | "later" | "takeaway";
  scheduled_at: string | null;
  city: string;
  public_area: string;
  created_at: string;
  last_msg_at: string | null;
  unread_count: number;
};

export default function SellerThreadsPage() {
  const nav = useNavigate();
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    refresh().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("get_seller_threads", { p_limit: 50 });
      if (error) throw error;
      setThreads((data ?? []) as any);
    } finally {
      setBusy(false);
    }
  }

  const emptyHint = useMemo(() => {
    if (busy) return "Loading…";
    if (!threads.length) return "No threads yet.";
    return "";
  }, [busy, threads.length]);

  function chip(status: ThreadRow["status"]) {
    const base = "px-2 py-0.5 rounded-full text-[11px] border";
    if (status === "open") return <span className={`${base} border-zinc-200 text-zinc-700`}>Open</span>;
    if (status === "locked")
      return <span className={`${base} border-amber-200 text-amber-700 bg-amber-50`}>Locked</span>;
    if (status === "fulfilled")
      return <span className={`${base} border-emerald-200 text-emerald-700 bg-emerald-50`}>Fulfilled</span>;
    return <span className={`${base} border-zinc-200 text-zinc-500 bg-zinc-50`}>Cancelled</span>;
  }

  return (
    <div className="mx-auto max-w-md px-4 py-5 pb-24">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-zinc-900">Threads</div>
          <div className="text-xs text-zinc-500">Engaged only (offers, orders, or chats)</div>
        </div>

        <button
          onClick={refresh}
          className="inline-flex items-center gap-2 rounded-full border border-zinc-200 px-3 py-1.5 text-xs text-zinc-800"
          disabled={busy}
        >
          <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
          {busy ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* Quick switch (WhatsApp-y) */}
      <div className="mb-4 flex gap-2">
        <button
          type="button"
          className="flex-1 rounded-full px-3 py-2 text-xs border bg-black text-white border-black inline-flex items-center justify-center gap-2"
          onClick={() => nav("/seller")}
        >
          <MessageCircle size={14} />
          Threads
        </button>
        <button
          type="button"
          className="flex-1 rounded-full px-3 py-2 text-xs border border-zinc-200 text-zinc-800 bg-white inline-flex items-center justify-center gap-2"
          onClick={() => nav("/seller/feed")}
        >
          <Store size={14} />
          Feed
        </button>
      </div>

      {/* Content */}
      {emptyHint ? (
        <div className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-[0_1px_0_rgba(0,0,0,0.03)]">
          <div className="text-sm font-medium text-zinc-900">{emptyHint}</div>
          <div className="mt-1 text-xs text-zinc-500">
            Threads appear only after you respond to a request. Browse the feed to find nearby requests.
          </div>

          <button
            onClick={() => nav("/seller/feed")}
            className="mt-4 w-full rounded-2xl bg-black text-white py-3 text-sm inline-flex items-center justify-center gap-2"
          >
            Browse available requests
            <ChevronRight size={16} />
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {threads.map((t) => (
            <Link
              key={t.request_id}
              to={`/seller/t/${t.request_id}`}
              className="block rounded-3xl border border-zinc-200 bg-white p-4 shadow-[0_1px_0_rgba(0,0,0,0.03)] active:scale-[0.99] transition"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] px-2 py-0.5 rounded-full border border-zinc-200 text-zinc-700">
                      {t.category}
                    </span>
                    <span className="text-[11px] text-zinc-500 truncate">
                      {t.public_area} • {t.city}
                    </span>
                  </div>

                  <div className="mt-2 text-[15px] leading-snug text-zinc-900 line-clamp-2">{t.text}</div>

                  <div className="mt-2 flex items-center gap-2 text-[12px] text-zinc-600">
                    {t.unread_count > 0 ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-black" />
                        {t.unread_count} new message{t.unread_count > 1 ? "s" : ""}
                      </span>
                    ) : (
                      <span className="text-zinc-500">No new updates</span>
                    )}
                    <span className="text-zinc-300">•</span>
                    <span className="text-zinc-500">
                      {t.mode === "later" && t.scheduled_at
                        ? "Scheduled"
                        : t.mode === "takeaway"
                        ? "Takeaway"
                        : "Now"}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-2 shrink-0">
                  {chip(t.status)}
                  <div className="text-[11px] text-zinc-500">
                    {new Date(t.last_msg_at ?? t.created_at).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                    })}
                  </div>
                  {t.unread_count > 0 ? (
                    <span className="min-w-[22px] h-[22px] px-2 rounded-full bg-black text-white text-[11px] flex items-center justify-center">
                      {t.unread_count}
                    </span>
                  ) : null}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Floating “Browse Feed” CTA (always visible) */}
      <div className="fixed bottom-5 left-0 right-0 z-20">
        <div className="mx-auto max-w-md px-4">
          <button
            onClick={() => nav("/seller/feed")}
            className="w-full rounded-2xl bg-black text-white py-3 text-sm shadow-lg inline-flex items-center justify-center gap-2"
          >
            <Store size={16} />
            Browse available requests
          </button>
        </div>
      </div>
    </div>
  );
}
