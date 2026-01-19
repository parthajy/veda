import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

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

const LS_LOC_KEY = "veda:buyer_location";

export default function BuyerThreadsPage() {
  const nav = useNavigate();
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [busy, setBusy] = useState(false);

  const hasAny = threads.length > 0;

  useEffect(() => {
    refresh().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("get_buyer_threads", { p_limit: 50 });
      if (error) throw error;
      setThreads((data ?? []) as any);
    } finally {
      setBusy(false);
    }
  }

  const emptyHint = useMemo(() => {
    if (busy) return "Loading…";
    if (!hasAny) return "No requests yet. Tap + to ask Veda.";
    return "";
  }, [busy, hasAny]);

  function chip(status: ThreadRow["status"]) {
    const base = "px-2 py-0.5 rounded-full text-[11px] border";
    if (status === "open") return <span className={`${base} border-zinc-200 text-zinc-700`}>Open</span>;
    if (status === "locked") return <span className={`${base} border-amber-200 text-amber-700 bg-amber-50`}>Locked</span>;
    if (status === "fulfilled") return <span className={`${base} border-emerald-200 text-emerald-700 bg-emerald-50`}>Fulfilled</span>;
    return <span className={`${base} border-zinc-200 text-zinc-500 bg-zinc-50`}>Cancelled</span>;
  }

  function ensureLocationOrGoAsk() {
  const raw = localStorage.getItem(LS_LOC_KEY);
  if (!raw) {
    alert("Set your City + Locality in Settings before asking.");
    nav("/settings");
    return;
  }
  nav("/ask");
}

  return (
    <div className="mx-auto max-w-md px-4 py-5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-zinc-900">Threads</div>
          <div className="text-xs text-zinc-500">Your requests & orders</div>
        </div>
        <button
          onClick={refresh}
          className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-800"
          disabled={busy}
        >
          {busy ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {emptyHint ? (
        <div className="text-xs text-zinc-500">{emptyHint}</div>
      ) : (
        <div className="space-y-2">
          {threads.map((t) => (
            <Link
  key={t.request_id}
  to={`/t/${t.request_id}`}
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

      <div className="mt-2 text-[15px] leading-snug text-zinc-900 line-clamp-2">
        {t.text}
      </div>

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
        {new Date(t.last_msg_at ?? t.created_at).toLocaleString([], { month: "short", day: "numeric" })}
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

      {/* Floating + */}
      <button
        onClick={ensureLocationOrGoAsk}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-black text-white text-2xl flex items-center justify-center shadow-lg"
        title="New request"
      >
        +
      </button>
    </div>
  );
}
