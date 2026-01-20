// /Users/partha/Desktop/veda/veda-web/src/pages/ThreadDetailPage.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import ThreadPhotosPanel from "../components/thread/ThreadPhotosPanel";

/**
 * IMPORTANT (required backend patch for negotiation-per-seller)
 * ------------------------------------------------------------
 * Your `messages` table currently does NOT have `seller_id`.
 * To support “one Request thread, but negotiation per seller”, you MUST add:
 *
 *   alter table public.messages add column seller_id uuid null;
 *   create index if not exists messages_request_seller_created_idx
 *     on public.messages (request_id, seller_id, created_at);
 *
 * And you must update RLS policies to include seller_id checks.
 * This page assumes `messages.seller_id` exists.
 */

type ReqRow = {
  id: string;
  status: "open" | "locked" | "fulfilled" | "cancelled";
  category: string;
  text: string;
  mode: "now" | "later" | "takeaway";
  scheduled_at: string | null;
  city: string;
  public_area: string;
  lat: number;
  lng: number;
  locked_seller_id: string | null;
  created_at: string;
};

type OfferRow = {
  id: string;
  seller_id: string;
  message: string;
  price_total: number | null;
  delivery_fee: number | null;
  fulfillment: "delivery" | "pickup";
  eta_minutes: number | null;
  status: "sent" | "accepted" | "rejected" | "expired";
  created_at: string;
};

type MsgRow = {
  id: string;
  request_id: string;
  seller_id: string | null;
  from_role: "user" | "seller";
  from_id: string;
  body: string;
  created_at: string;
};

type OrderRow = {
  id: string;
  request_id: string;
  offer_id: string;
  status: "locked" | "fulfilled" | "cancelled";
  delivery_state?: "preparing" | "on_the_way" | "arrived" | "fulfilled" | "cancelled";
  eta_minutes?: number | null;
  created_at: string;
};

export default function ThreadDetailPage() {
  const { requestId } = useParams();
  const nav = useNavigate();

  const [tab, setTab] = useState<"details" | "chat">("details");
  const [req, setReq] = useState<ReqRow | null>(null);
  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [msgs, setMsgs] = useState<MsgRow[]>([]);
  const [order, setOrder] = useState<OrderRow | null>(null);
  const [pin, setPin] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");

  // Negotiation per seller inside one Request thread
  const [activeSellerId, setActiveSellerId] = useState<string | null>(null);

  const didInit = useRef(false);

  useEffect(() => {
    if (!requestId) return;
    if (didInit.current) return;
    didInit.current = true;

    (async () => {
      await refreshAll();
      await markRead();

      const ch = supabase
        .channel(`thread_${requestId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "messages", filter: `request_id=eq.${requestId}` },
          async () => {
            await refreshMessages();
          }
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "offers", filter: `request_id=eq.${requestId}` },
          async () => {
            await refreshOffers();
            await refreshMessages(); // offers can change which sellers exist
          }
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "orders", filter: `request_id=eq.${requestId}` },
          async () => {
            await refreshOrder();
          }
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "requests", filter: `id=eq.${requestId}` },
          async () => {
            await refreshReq(); // lock status can change
            await maybeAutoSelectSellerFromState();
            await refreshMessages();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(ch);
      };
    })().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId]);

  useEffect(() => {
    if (tab === "chat") markRead().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function refreshAll() {
    setBusy(true);
    try {
      // order matters: req -> offers -> seller selection -> messages
      await refreshReq();
      await refreshOffers();
      await maybeAutoSelectSellerFromState();
      await Promise.all([refreshMessages(), refreshOrder()]);
    } finally {
      setBusy(false);
    }
  }

  async function refreshReq() {
    if (!requestId) return;
    const { data, error } = await supabase.from("requests").select("*").eq("id", requestId).single();
    if (error) throw error;
    setReq(data as any);
  }

  async function refreshOffers() {
    if (!requestId) return;
    const { data, error } = await supabase
      .from("offers")
      .select("id, seller_id, message, price_total, delivery_fee, fulfillment, eta_minutes, status, created_at")
      .eq("request_id", requestId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    setOffers((data ?? []) as any);
  }

  async function maybeAutoSelectSellerFromState() {
    // If locked -> force to locked seller
    const lockedSeller = req?.locked_seller_id ?? null;
    if (lockedSeller) {
      setActiveSellerId(lockedSeller);
      return;
    }

    // If not locked, keep current selection if still valid
    if (activeSellerId && offers.some((o) => o.seller_id === activeSellerId)) return;

    // Otherwise, pick most recent seller (top offer)
    if (offers.length > 0) {
      setActiveSellerId(offers[0].seller_id);
      return;
    }

    // No offers yet
    setActiveSellerId(null);
  }

  async function refreshMessages() {
    if (!requestId) return;

    const lockedSeller = req?.locked_seller_id ?? null;
    const sellerForChat = lockedSeller ?? activeSellerId;

    if (!sellerForChat) {
      setMsgs([]);
      return;
    }

    const { data, error } = await supabase
      .from("messages")
      .select("id, request_id, seller_id, from_role, from_id, body, created_at")
      .eq("request_id", requestId)
      .eq("seller_id", sellerForChat)
      .order("created_at", { ascending: true });

    if (error) throw error;
    setMsgs((data ?? []) as any);
  }

  async function refreshOrder() {
    if (!requestId) return;

    const { data, error } = await supabase
      .from("orders")
      .select("id, request_id, offer_id, status, delivery_state, eta_minutes, created_at")
      .eq("request_id", requestId)
      .maybeSingle();

    if (error) throw error;
    setOrder((data as any) ?? null);

    if (data?.id) {
      const { data: pinRow } = await supabase
        .from("order_pins")
        .select("order_id, pin_plain")
        .eq("order_id", data.id)
        .maybeSingle();

      setPin((pinRow as any)?.pin_plain ?? null);
    } else {
      setPin(null);
    }
  }

  async function markRead() {
    if (!requestId) return;
    const user = (await supabase.auth.getUser()).data.user;
    if (!user) return;

    await supabase.from("thread_reads").upsert(
      { request_id: requestId, profile_id: user.id, last_read_at: new Date().toISOString() },
      { onConflict: "request_id,profile_id" }
    );
  }

  async function sendMessage() {
    if (!requestId) return;

    const text = draft.trim();
    if (!text) return;

    const user = (await supabase.auth.getUser()).data.user;
    if (!user) return;

    const lockedSeller = req?.locked_seller_id ?? null;
    const sellerForChat = lockedSeller ?? activeSellerId;

    if (!sellerForChat) {
      alert("No seller selected yet. Wait for an offer, then pick a seller to negotiate with.");
      return;
    }

    setSending(true);
    try {
      const { error } = await supabase.from("messages").insert({
        request_id: requestId,
        seller_id: sellerForChat, // REQUIRED for negotiation-per-seller
        from_role: "user",
        from_id: user.id,
        body: text,
      });
      if (error) throw error;

      setDraft("");
      await refreshMessages();
      await markRead();
    } catch (e: any) {
      alert(e.message ?? "Failed to send");
    } finally {
      setSending(false);
    }
  }

  async function rejectOffer(offerId: string) {
  setBusy(true);
  try {
    const { error } = await supabase.rpc("reject_offer", { p_offer_id: offerId });
    if (error) {
      alert(error.message);
      return;
    }
    await refreshOffers();
    await refreshMessages(); // optional: in case seller lanes depend on offers
  } finally {
    setBusy(false);
  }
}

  async function acceptOffer(offerId: string) {
    const u = (await supabase.auth.getUser()).data.user;
if (!u) throw new Error("Not signed in");
  setBusy(true);
  try {
    const chosen = offers.find((o) => o.id === offerId);
    if (chosen?.seller_id) setActiveSellerId(chosen.seller_id);

    const { data, error } = await supabase.rpc("accept_offer_and_lock", { p_offer_id: offerId });
    if (error) {
      console.error("accept_offer_and_lock error", error);
      alert(`${error.message}\n${error.details ?? ""}\n${error.hint ?? ""}`);
      return;
    }
    console.log("accept_offer_and_lock ok", data);

    // After accepting, share buyer phone number (if present) so the seller can call.
// We send it as a normal chat message for now (simple + works across web + app).
if (chosen?.seller_id) {
  const { data: prof } = await supabase
    .from("profiles")
    .select("phone")
    .eq("id", u.id)
    .maybeSingle();

  const phone = (prof as any)?.phone ? String((prof as any).phone).trim() : "";
  if (phone) {
    await supabase.from("messages").insert({
      request_id: requestId,
      seller_id: chosen.seller_id,
      from_role: "user",
      from_id: u.id,
      body: `My phone number: ${phone}`,
    });
  } else {
    // Don't block acceptance; just inform.
    alert("Order accepted. Add your phone in Settings if you want the seller to call you.");
  }
}

    await refreshAll();
    setTab("details");
  } finally {
    setBusy(false);
  }
}

  const headerTitle = useMemo(() => {
    if (!req) return "Thread";
    return `${req.category} • ${req.public_area}`;
  }, [req]);

  const lockedSeller = req?.locked_seller_id ?? null;
  const sellerForChat = lockedSeller ?? activeSellerId;

  return (
    <div className="mx-auto max-w-md px-4 py-5">
      <div className="mb-3 flex items-center justify-between">
        <button className="text-xs text-zinc-600" onClick={() => nav("/")}>
          ← Back
        </button>
        <div className="text-sm font-medium text-zinc-900 truncate">{headerTitle}</div>
        <button
          className="text-xs text-zinc-600"
          onClick={() => refreshAll().catch((e) => alert(e.message))}
          disabled={busy}
        >
          {busy ? "…" : "Refresh"}
        </button>
      </div>

      {/* Tabs */}
            <div className="mb-4 rounded-full border border-zinc-200 bg-zinc-50 p-1 flex">
        <button
          onClick={() => setTab("details")}
          className={[
            "flex-1 rounded-full px-3 py-2 text-xs font-medium",
            tab === "details" ? "bg-white shadow-sm border border-zinc-200" : "text-zinc-600",
          ].join(" ")}
        >
          Order
        </button>

        <button
          onClick={() => setTab("chat")}
          className={[
            "flex-1 rounded-full px-3 py-2 text-xs font-medium",
            tab === "chat" ? "bg-white shadow-sm border border-zinc-200" : "text-zinc-600",
          ].join(" ")}
        >
          Chat
        </button>
      </div>

      {tab === "details" && order?.id ? (
        <div className="rounded-3xl border border-zinc-200 bg-white p-4 mb-3">
          <div className="text-sm font-medium text-zinc-900">Delivery</div>
          <div className="mt-2 flex items-center justify-between">
            <div className="text-xs text-zinc-600">
              Status:{" "}
              <span className="text-zinc-900 font-medium">
                {(order as any).delivery_state === "on_the_way"
                  ? "On the way"
                  : (order as any).delivery_state === "arrived"
                  ? "Arrived"
                  : "Preparing"}
              </span>
            </div>
            <div className="text-xs text-zinc-600">
              ETA:{" "}
              <span className="text-zinc-900 font-medium">
                {(order as any).eta_minutes ? `${(order as any).eta_minutes} min` : "—"}
              </span>
            </div>
          </div>
          <div className="mt-2 text-[11px] text-zinc-500">
            Seller updates this when they start delivery.
          </div>
        </div>
      ) : null}

      {tab === "details" && requestId ? (
        <div className="mb-3">
          <ThreadPhotosPanel requestId={requestId} uploaderRole="buyer" />
        </div>
      ) : null}


      {!req ? (
        <div className="text-sm text-zinc-600">Loading…</div>
      ) : tab === "details" ? (
        <DetailsPanel
  req={req}
  offers={offers}
  order={order}
  pin={pin}
  onAccept={acceptOffer}
  onReject={rejectOffer}
/>
      ) : (
        <ChatPanel
          reqStatus={req.status}
          lockedSellerId={lockedSeller}
          offers={offers}
          activeSellerId={sellerForChat}
          onPickSeller={(id) => {
            if (lockedSeller) return; // locked: cannot switch
            setActiveSellerId(id);
            // refresh messages immediately on switch
            setTimeout(() => refreshMessages().catch(() => {}), 0);
          }}
          msgs={msgs}
          draft={draft}
          onDraft={setDraft}
          onSend={sendMessage}
          sending={sending}
        />
      )}
    </div>
  );
}

function DetailsPanel({
  req,
  offers,
  order,
  pin,
  onAccept,
  onReject,
}: {
  req: ReqRow;
  offers: OfferRow[];
  order: OrderRow | null;
  pin: string | null;
  onAccept: (offerId: string) => void;
  onReject: (offerId: string) => void;
}) {
  const statusChip = (() => {
    const base = "px-2 py-0.5 rounded-full text-[11px] border";
    if (req.status === "open") return <span className={`${base} border-zinc-200 text-zinc-700`}>Open</span>;
    if (req.status === "locked") return <span className={`${base} border-amber-200 text-amber-700 bg-amber-50`}>Locked</span>;
    if (req.status === "fulfilled") return <span className={`${base} border-emerald-200 text-emerald-700 bg-emerald-50`}>Fulfilled</span>;
    return <span className={`${base} border-zinc-200 text-zinc-500 bg-zinc-50`}>Cancelled</span>;
  })();

  return (
    <div className="space-y-3">
      <div className="border border-zinc-200 rounded-2xl p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-zinc-500">
              {req.city} • {req.public_area}
            </div>
            <div className="mt-1 text-sm text-zinc-900">{req.text}</div>
            <div className="mt-2 text-[11px] text-zinc-500">
              {req.mode === "later" && req.scheduled_at
                ? `Later • ${new Date(req.scheduled_at).toLocaleString()}`
                : req.mode === "takeaway"
                ? "Takeaway"
                : "Now"}
            </div>
          </div>
          {statusChip}
        </div>

        {order?.id && pin ? (
          <div className="mt-3 rounded-xl border border-zinc-200 p-3">
            <div className="text-xs text-zinc-500">Delivery PIN (share only when item arrives)</div>
            <div className="mt-1 text-2xl tracking-widest font-semibold">{pin}</div>
          </div>
        ) : null}
      </div>

      <div className="border border-zinc-200 rounded-2xl p-3">
        <div className="text-sm font-medium text-zinc-900">Offers</div>
        <div className="mt-2 space-y-2">
          {offers.length === 0 ? (
            <div className="text-xs text-zinc-500">No offers yet.</div>
          ) : (
            offers.map((o) => (
              <div key={o.id} className="rounded-2xl border border-zinc-200 p-3">
                <div className="text-xs text-zinc-500">
                  Offer • {o.fulfillment} • {o.eta_minutes ? `${o.eta_minutes} min` : "ETA?"}
                </div>
                <div className="mt-1 text-sm text-zinc-900">{o.message}</div>

                <div className="mt-2 flex items-center justify-between">
                  <div className="text-xs text-zinc-600">
                    {o.price_total != null ? `₹${o.price_total}` : "₹?"}
                    {o.delivery_fee != null ? ` • Delivery ₹${o.delivery_fee}` : ""}
                    <span className="ml-2 text-zinc-500">• {o.status}</span>
                  </div>

                  {req.status === "open" && o.status === "sent" ? (
  <div className="flex gap-2">
    <button
      onClick={() => onAccept(o.id)}
      className="rounded-full bg-black text-white px-3 py-1 text-xs"
    >
      Accept
    </button>
    <button
      onClick={() => onReject(o.id)}
      className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-700"
    >
      Reject
    </button>
  </div>
) : null}

                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function ChatPanel({
  reqStatus,
  lockedSellerId,
  offers,
  activeSellerId,
  onPickSeller,
  msgs,
  draft,
  onDraft,
  onSend,
  sending,
}: {
  reqStatus: ReqRow["status"];
  lockedSellerId: string | null;
  offers: OfferRow[];
  activeSellerId: string | null;
  onPickSeller: (sellerId: string) => void;
  msgs: MsgRow[];
  draft: string;
  onDraft: (v: string) => void;
  onSend: () => void;
  sending: boolean;
}) {
  const uniqueSellers = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ seller_id: string; last_offer_at: string; last_offer_msg: string }> = [];
    for (const o of offers) {
      if (seen.has(o.seller_id)) continue;
      seen.add(o.seller_id);
      out.push({ seller_id: o.seller_id, last_offer_at: o.created_at, last_offer_msg: o.message });
    }
    return out;
  }, [offers]);

  const canSwitchSeller = reqStatus === "open" && !lockedSellerId;

  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    // WhatsApp behaviour: always stay at the latest message when new ones arrive
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [msgs.length, activeSellerId]);

  function short(id: string) {
    return `Seller ${id.slice(0, 4).toUpperCase()}`;
  }

  // Grouping: show timestamp only when gap > 5 mins or sender changes
  function shouldShowMeta(idx: number) {
    const a = msgs[idx];
    const b = msgs[idx - 1];
    if (!b) return true;
    if (a.from_role !== b.from_role) return true;
    const dt = Math.abs(new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    return dt > 5 * 60 * 1000;
  }

  return (
    <div className="rounded-3xl border border-zinc-200 bg-white overflow-hidden">
      {/* Header strip: seller lanes */}
      <div className="px-4 py-3 border-b border-zinc-200 bg-white">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-zinc-900">Chat</div>
            <div className="mt-0.5 text-[11px] text-zinc-500">
              {lockedSellerId
                ? "Locked: chat is now fixed with the accepted seller."
                : "Each seller has a separate negotiation lane."}
            </div>
          </div>
          {lockedSellerId ? (
            <span className="shrink-0 px-2 py-0.5 rounded-full text-[11px] border border-amber-200 text-amber-700 bg-amber-50">
              Locked
            </span>
          ) : null}
        </div>

        {uniqueSellers.length === 0 ? (
          <div className="mt-2 text-xs text-zinc-500">No sellers yet. Wait for offers.</div>
        ) : (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {uniqueSellers.map((s) => {
              const active = s.seller_id === activeSellerId;
              return (
                <button
                  key={s.seller_id}
                  type="button"
                  onClick={() => canSwitchSeller && onPickSeller(s.seller_id)}
                  disabled={!canSwitchSeller}
                  className={[
                    "shrink-0 rounded-full px-3 py-1.5 text-xs border transition",
                    active
                      ? "bg-black text-white border-black"
                      : "bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50",
                    !canSwitchSeller ? "opacity-70 cursor-not-allowed" : "",
                  ].join(" ")}
                  title={s.last_offer_msg}
                >
                  {lockedSellerId ? "Seller" : short(s.seller_id)}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Messages (full-height feel) */}
      <div
        ref={listRef}
        className="px-3 py-3 h-[52vh] overflow-y-auto bg-zinc-50"
      >
        {!activeSellerId ? (
          <div className="px-2 py-10 text-center text-xs text-zinc-500">
            Pick a seller lane to open chat.
          </div>
        ) : msgs.length === 0 ? (
          <div className="px-2 py-10 text-center text-xs text-zinc-500">
            No messages yet. Send a quick hello or counter-offer.
          </div>
        ) : (
          <div className="space-y-2">
            {msgs.map((m, idx) => {
              const mine = m.from_role === "user";
              return (
                <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[86%] ${mine ? "items-end" : "items-start"} flex flex-col`}>
                    <div
                      className={[
                        "rounded-2xl px-3 py-2 text-[14px] leading-snug border shadow-[0_1px_0_rgba(0,0,0,0.02)]",
                        mine
                          ? "bg-white border-zinc-200"
                          : "bg-white border-zinc-200",
                      ].join(" ")}
                    >
                      <div className="text-zinc-900 whitespace-pre-wrap">{m.body}</div>
                    </div>

                    {shouldShowMeta(idx) ? (
                      <div className="mt-1 text-[10px] text-zinc-500 px-1">
                        {new Date(m.created_at).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Composer (sticky feel) */}
      <div className="border-t border-zinc-200 bg-white p-3">
        <div className="flex items-center gap-2">
          <input
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            placeholder={!activeSellerId ? "Pick a seller first…" : "Message…"}
            className="flex-1 border border-zinc-200 rounded-full px-4 py-3 text-sm outline-none bg-white"
            disabled={!activeSellerId || sending}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSend();
            }}
          />
          <button
            onClick={onSend}
            disabled={sending || !activeSellerId}
            className="rounded-full bg-black text-white px-4 py-3 text-sm disabled:opacity-60"
          >
            {sending ? "…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}