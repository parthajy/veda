// src/pages/SellerOrderPage.tsx
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import ThreadPhotosPanel from "../components/thread/ThreadPhotosPanel";

type LocRow = {
  lat: number;
  lng: number;
  public_area: string;
  city: string;
};

export default function SellerOrderPage() {
  const { orderId } = useParams();
  const [loc, setLoc] = useState<LocRow | null>(null);
  const [buyerPhone, setBuyerPhone] = useState<string | null>(null);
  const [buyerUserId, setBuyerUserId] = useState<string | null>(null);

  const [pin, setPin] = useState("");
  const [ok, setOk] = useState<boolean | null>(null);

  const [deliveryState, setDeliveryState] = useState<"preparing" | "on_the_way" | "arrived">("preparing");
  const [eta, setEta] = useState<number | null>(null);
  const [savingState, setSavingState] = useState(false);

  const mapsUrl = useMemo(() => {
    if (!loc) return null;
    const q = encodeURIComponent(`${loc.lat},${loc.lng}`);
    return `https://www.google.com/maps/search/?api=1&query=${q}`;
  }, [loc]);

  const telUrl = useMemo(() => {
if (!buyerPhone) return null;
    const p = buyerPhone.replace(/[^\d+]/g, "");
    return p ? `tel:${p}` : null;
  }, [buyerPhone]);

  useEffect(() => {
    if (!orderId) return;
    (async () => {
      // location (seller-only, only when locked)
      const { data, error } = await supabase.rpc("get_order_location", { p_order_id: orderId });
      if (error) throw error;
      setLoc(data?.[0] ?? null);

      // delivery state + eta (read from orders)
      const { data: o, error: oErr } = await supabase
        .from("orders")
        .select("delivery_state, eta_minutes, request_id")
        .eq("id", orderId)
        .maybeSingle();

      if (!oErr && o) {
        const s = (o as any).delivery_state as any;
        if (s === "on_the_way" || s === "arrived" || s === "preparing") setDeliveryState(s);
        setEta((o as any).eta_minutes ?? null);
      }

      // buyer phone (only meaningful after locked; safe to show "not shared" otherwise)
      const requestId = (o as any)?.request_id as string | undefined;
      if (requestId) {
        const { data: reqRow, error: reqErr } = await supabase
          .from("requests")
          .select("user_id")
          .eq("id", requestId)
          .maybeSingle();
        if (!reqErr && reqRow?.user_id) {
          setBuyerUserId((reqRow as any).user_id);
          const { data: prof, error: pErr } = await supabase
            .from("profiles")
            .select("phone")
            .eq("id", (reqRow as any).user_id)
            .maybeSingle();
          if (!pErr) {
            const phone = (prof as any)?.phone ? String((prof as any).phone).trim() : "";
            setBuyerPhone(phone || null);
          }
        }
      }
    })().catch((e) => alert(e.message));
  }, [orderId]);

  async function fulfill() {
    if (!orderId) return;
    const { data, error } = await supabase.rpc("fulfill_order_with_pin", {
      p_order_id: orderId,
      p_pin: pin,
    });
    if (error) alert(error.message);
    else setOk(!!data);
  }

  async function saveDelivery() {
    if (!orderId) return;
    setSavingState(true);
    try {
      const { data, error } = await supabase.rpc("set_order_delivery_state", {
        p_order_id: orderId,
        p_delivery_state: deliveryState,
        p_eta_minutes: eta,
      });
      if (error) throw error;
      if (!data) throw new Error("Could not update");
    } catch (e: any) {
      alert(e.message ?? "Failed to update delivery status");
    } finally {
      setSavingState(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-5 space-y-4">
      <div className="text-sm mb-1">Order</div>

      <div className="border border-zinc-200 rounded-2xl p-3 bg-white">
        {!loc ? (
          <div className="text-xs text-zinc-500">Location not available (order must be locked to you).</div>
        ) : (
          <>
            <div className="text-xs text-zinc-500">
              {loc.public_area} • {loc.city}
            </div>

            <div className="mt-2 text-sm text-zinc-900">Exact pin drop</div>
            <div className="mt-1 text-xs text-zinc-700">
              Lat: {loc.lat} <br /> Lng: {loc.lng}
            </div>

            {mapsUrl ? (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex w-full justify-center rounded-xl bg-black text-white py-2 text-sm"
              >
                Open in Maps
              </a>
            ) : null}
          </>
        )}
      </div>

      {/* Buyer contact */}
      <div className="border border-zinc-200 rounded-2xl p-3 bg-white">
        <div className="text-sm font-medium text-zinc-900">Buyer contact</div>
        <div className="mt-1 text-xs text-zinc-500">
          Visible after buyer accepts (if they added phone in Settings).
        </div>

        {buyerPhone ? (
          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs text-zinc-500">Phone</div>
              <div className="text-sm text-zinc-900 font-medium truncate">{buyerPhone}</div>
            </div>
            {telUrl ? (
              <a
                href={telUrl}
                className="shrink-0 rounded-full bg-black text-white px-4 py-2 text-sm"
              >
                Call
              </a>
            ) : null}
          </div>
        ) : (
          <div className="mt-3 text-xs text-zinc-600">
            Not shared yet.
          </div>
        )}
      </div>

      {/* Delivery status */}
      <div className="border border-zinc-200 rounded-2xl p-3 bg-white">
        <div className="text-sm font-medium text-zinc-900">Delivery status</div>
        <div className="mt-1 text-xs text-zinc-500">This is what the buyer sees. Keep it simple.</div>

        <div className="mt-3 flex gap-2">
          {(["preparing", "on_the_way", "arrived"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setDeliveryState(s)}
              className={[
                "flex-1 rounded-full px-3 py-2 text-xs border transition",
                deliveryState === s ? "bg-black text-white border-black" : "bg-white text-zinc-700 border-zinc-200",
              ].join(" ")}
            >
              {s === "preparing" ? "Preparing" : s === "on_the_way" ? "On the way" : "Arrived"}
            </button>
          ))}
        </div>

        <div className="mt-3">
          <div className="text-[11px] text-zinc-500 mb-1">ETA (minutes)</div>
          <input
            type="number"
            min={1}
            max={240}
            step={1}
            value={eta ?? ""}
            onChange={(e) => setEta(e.target.value === "" ? null : Number(e.target.value))}
            className="w-full border border-zinc-200 rounded-xl px-3 py-2 text-sm outline-none"
            placeholder="e.g. 25"
          />
        </div>

        <button
          onClick={saveDelivery}
          disabled={savingState}
          className="mt-3 w-full rounded-xl border border-zinc-200 bg-white py-2 text-sm"
        >
          {savingState ? "Saving…" : "Update status"}
        </button>
      </div>

      {/* PIN fulfillment */}
      <div className="border border-zinc-200 rounded-2xl p-3 bg-white">
        <div className="text-xs text-zinc-500">Enter PIN to fulfill</div>
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          className="mt-2 w-full border border-zinc-200 rounded-xl px-3 py-2 text-sm"
          placeholder="4-digit PIN"
        />
        <button onClick={fulfill} className="mt-3 w-full rounded-xl bg-black text-white py-2 text-sm">
          Fulfill
        </button>
        {ok !== null && (
          <div className="mt-2 text-xs">
            {ok ? <span className="text-emerald-700">Fulfilled.</span> : <span className="text-red-600">Wrong PIN.</span>}
          </div>
        )}
      </div>

      {/* Photos (seller can upload too) */}
      {loc ? (
        // requestId is not in this component; easiest: infer from order row
        <OrderPhotos orderId={orderId ?? ""} />
      ) : null}
    </div>
  );
}

function OrderPhotos({ orderId }: { orderId: string }) {
  const [requestId, setRequestId] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId) return;
    (async () => {
      const { data, error } = await supabase.from("orders").select("request_id").eq("id", orderId).maybeSingle();
      if (error) throw error;
      setRequestId((data as any)?.request_id ?? null);
    })().catch((e) => alert(e.message));
  }, [orderId]);

  if (!requestId) return null;
return <ThreadPhotosPanel requestId={requestId} uploaderRole="seller" />;
}
