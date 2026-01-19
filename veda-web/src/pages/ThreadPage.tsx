// src/pages/ThreadPage.tsx
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";

type Offer = {
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

type Msg = {
  id: string;
  from_role: "user" | "seller";
  body: string;
  created_at: string;
};

export default function ThreadPage() {
  const { requestId } = useParams();
  const [req, setReq] = useState<any>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [ask, setAsk] = useState("");
  const [pin, setPin] = useState<string | null>(null);
  const [busyAccept, setBusyAccept] = useState<string | null>(null);

  useEffect(() => {
    if (!requestId) return;

    let unsubOffers: any;
    let unsubMsgs: any;

    (async () => {
      await refreshRequest(requestId);
      await refreshOffers(requestId);
      await refreshMsgs(requestId);
      await maybeFetchPin(requestId);

      unsubOffers = supabase
        .channel(`offers:${requestId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "offers", filter: `request_id=eq.${requestId}` },
          () => refreshOffers(requestId)
        )
        .subscribe();

      unsubMsgs = supabase
        .channel(`messages:${requestId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages", filter: `request_id=eq.${requestId}` },
          () => refreshMsgs(requestId)
        )
        .subscribe();
    })().catch((e) => alert(e.message ?? "Failed"));

    return () => {
      if (unsubOffers) supabase.removeChannel(unsubOffers);
      if (unsubMsgs) supabase.removeChannel(unsubMsgs);
    };
  }, [requestId]);

  async function refreshRequest(rid: string) {
    const r = await supabase.from("requests").select("*").eq("id", rid).single();
    if (r.error) throw r.error;
    setReq(r.data);
  }

  async function refreshOffers(rid: string) {
    const o = await supabase
      .from("offers")
      .select("*")
      .eq("request_id", rid)
      .order("created_at", { ascending: true });
    if (!o.error) setOffers(o.data as any);
  }

  async function refreshMsgs(rid: string) {
    const m = await supabase
      .from("messages")
      .select("*")
      .eq("request_id", rid)
      .order("created_at", { ascending: true });
    if (!m.error) setMsgs(m.data as any);
  }

  async function maybeFetchPin(rid: string) {
    const ord = await supabase.from("orders").select("id").eq("request_id", rid).maybeSingle();
    if (ord.error || !ord.data) return;

    const p = await supabase.from("order_pins").select("pin_plain").eq("order_id", ord.data.id).maybeSingle();
    if (!p.error && p.data?.pin_plain) setPin(p.data.pin_plain);
  }

  const acceptedOfferId = useMemo(() => offers.find((o) => o.status === "accepted")?.id ?? null, [offers]);

  async function sendAsk() {
    if (!requestId) return;
    const body = ask.trim();
    if (!body) return;

    const user = (await supabase.auth.getUser()).data.user;
    if (!user) return;

    const ins = await supabase.from("messages").insert({
      request_id: requestId,
      from_role: "user",
      from_id: user.id,
      body,
    });
    if (ins.error) alert(ins.error.message);
    setAsk("");
  }

  async function acceptOffer(offerId: string) {
    if (!requestId) return;
    setBusyAccept(offerId);

    try {
      const { error } = await supabase.rpc("accept_offer_and_lock", { p_offer_id: offerId });
      if (error) throw error;

      await refreshRequest(requestId);
      await refreshOffers(requestId);
      await maybeFetchPin(requestId);
    } catch (e: any) {
      alert(e.message ?? "Failed to accept");
    } finally {
      setBusyAccept(null);
    }
  }

  if (!req) return <div className="mx-auto max-w-md px-4 py-6 text-sm">Loading thread…</div>;

  return (
    <div className="mx-auto max-w-md px-4 py-5">
      <div className="border border-zinc-200 rounded-2xl p-3">
        <div className="text-xs text-zinc-500">
          {req.public_area} • {req.city}
        </div>
        <div className="mt-1 text-sm">{req.text}</div>
        <div className="mt-2 text-xs text-zinc-600">
          Status: <span className="font-medium">{req.status}</span>
        </div>

        {pin && (
          <div className="mt-3 rounded-xl border border-zinc-200 p-3">
            <div className="text-xs text-zinc-500">Your PIN</div>
            <div className="mt-1 text-2xl font-semibold tracking-widest">{pin}</div>
            <div className="mt-1 text-xs text-zinc-500">Share this PIN only at pickup/delivery.</div>
          </div>
        )}
      </div>

      <div className="mt-4 space-y-2">
        {offers.length === 0 ? (
          <div className="text-xs text-zinc-500">No offers yet.</div>
        ) : (
          offers.map((o) => (
            <div key={o.id} className="border border-zinc-200 rounded-2xl p-3">
              <div className="text-xs text-zinc-500">
                Offer • {o.fulfillment} {o.eta_minutes ? `• ${o.eta_minutes} min` : ""}
              </div>
              <div className="mt-1 text-sm whitespace-pre-wrap">{o.message}</div>
              <div className="mt-2 text-xs text-zinc-600">
                {o.price_total != null ? `₹${o.price_total}` : "Price: not set"}
                {o.delivery_fee != null ? ` • Delivery ₹${o.delivery_fee}` : ""}
              </div>

              <div className="mt-2 flex items-center gap-2">
                {o.status === "sent" && !acceptedOfferId && (
                  <button
                    onClick={() => acceptOffer(o.id)}
                    disabled={busyAccept === o.id}
                    className="rounded-full bg-black text-white px-3 py-1 text-xs"
                  >
                    {busyAccept === o.id ? "Accepting…" : "Accept"}
                  </button>
                )}
                {o.status === "accepted" && <span className="text-xs font-medium text-emerald-700">Accepted</span>}
                {o.status === "rejected" && <span className="text-xs text-zinc-500">Rejected</span>}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="mt-4 border-t border-zinc-200 pt-3">
        <div className="text-xs text-zinc-500 mb-2">Negotiation</div>

        <div className="space-y-2">
          {msgs.map((m) => (
            <Bubble key={m.id} role={m.from_role} body={m.body} />
          ))}
        </div>

        <div className="mt-3 flex gap-2">
          <input
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            placeholder="Ask one thing…"
            className="flex-1 border border-zinc-200 rounded-full px-3 py-2 text-sm outline-none"
          />
          <button onClick={sendAsk} className="rounded-full bg-black text-white px-4 text-sm">
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function Bubble({ role, body }: { role: "user" | "seller"; body: string }) {
  const mine = role === "user";
  return (
    <div className={mine ? "flex justify-end" : "flex justify-start"}>
      <div
        className={[
          "max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap",
          mine ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-900",
        ].join(" ")}
      >
        {body}
      </div>
    </div>
  );
}
