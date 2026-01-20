// src/pages/SellerFeedPage.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import OfferSheet from "../components/seller/OfferSheet";

type VisibleReq = {
  request_id: string;
  category: string;
  text: string;
  mode: "now" | "later" | "takeaway";
  scheduled_at: string | null;
  city: string;
  public_area: string;
  distance_km: number;
  created_at: string;
};

type OrderRow = {
  id: string;
  request_id: string;
  status: "locked" | "fulfilled" | "cancelled";
  created_at: string;
};

type SellerLoc = {
  id: string;
  seller_id: string;
  city: string;
  lat: number | null;
  lng: number | null;
  radius_km: number;
  active: boolean;
};

export default function SellerFeedPage() {
  const didInit = useRef(false);
  const [loc, setLoc] = useState<SellerLoc | null>(null);
  const [items, setItems] = useState<VisibleReq[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [busyFeed, setBusyFeed] = useState(false);
  const [busyOrders, setBusyOrders] = useState(false);

  const [offerOpen, setOfferOpen] = useState(false);
  const [offerReq, setOfferReq] = useState<VisibleReq | null>(null);

  const feedEmptyText = useMemo(() => {
    if (!loc) return "";
    if (loc.lat == null || loc.lng == null) return "Set your location (lat/lng) in Settings.";
    if (busyFeed) return "Refreshing…";
    if (!items.length) return "No nearby requests right now.";
    return "";
  }, [busyFeed, items.length, loc]);

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;

    (async () => {
      const found = await ensureSellerLocation(); // ✅ get actual row
      if (found) {
        await Promise.all([refreshFeed(found), refreshOrders()]); // ✅ no race
      } else {
        // still load orders (in case)
        await refreshOrders();
      }

      const user = (await supabase.auth.getUser()).data.user;
      if (!user) return;

      const ch = supabase
        .channel(`seller_orders_${user.id}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "orders", filter: `seller_id=eq.${user.id}` },
          () => refreshOrders()
        )
        .subscribe();

      return () => {
        supabase.removeChannel(ch);
      };
    })().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ensureSellerLocation(): Promise<SellerLoc | null> {
    const user = (await supabase.auth.getUser()).data.user;
    if (!user) throw new Error("No user");

    const { data: rows, error } = await supabase
      .from("seller_locations")
      .select("*")
      .eq("seller_id", user.id)
      .eq("active", true)
      .order("created_at", { ascending: false });

    if (error) throw error;

    if (!rows || rows.length === 0) {
      setLoc(null);
      return null;
    }

    const keep = rows[0] as any as SellerLoc;
    const extras = rows.slice(1);
    if (extras.length > 0) {
      await supabase
        .from("seller_locations")
        .update({ active: false })
        .in(
          "id",
          extras.map((r) => r.id)
        );
    }

    setLoc(keep);
    return keep;
  }

  async function saveSellerLocation(next: Pick<SellerLoc, "city" | "lat" | "lng" | "radius_km">) {
    const user = (await supabase.auth.getUser()).data.user;
    if (!user) return;

    if (loc?.id) {
      const { data, error } = await supabase
        .from("seller_locations")
        .update({
          city: (next.city ?? "").trim(),
          lat: next.lat,
          lng: next.lng,
          radius_km: next.radius_km,
          active: true,
        })
        .eq("id", loc.id)
        .select("*")
        .single();

      if (error) throw error;
      setLoc(data as any);
      return;
    }

    const { data, error } = await supabase
      .from("seller_locations")
      .update({
        city: (next.city ?? "").trim(),
        lat: next.lat,
        lng: next.lng,
        radius_km: next.radius_km,
        active: true,
      })
      .eq("seller_id", user.id)
      .eq("active", true)
      .select("*")
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (data) setLoc(data as any);
  }

  async function useDeviceLocation() {
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        if (!loc) return;
        await saveSellerLocation({
          city: loc.city,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          radius_km: loc.radius_km,
        });
        await refreshFeed({
          ...loc,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        } as any);
      },
      () => {
        alert("Location permission denied. Enter coordinates manually.");
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  async function refreshAll() {
    // ✅ always refresh using current loc
    await Promise.all([refreshFeed(), refreshOrders()]);
  }

  async function refreshFeed(overrideLoc?: SellerLoc | null) {
    const L = overrideLoc ?? loc;
    if (!L) return;
        if (L.lat == null || L.lng == null) {
      setItems([]);
      return;
    }

    setBusyFeed(true);
    try {
      const { data, error } = await supabase.rpc("get_visible_requests_for_seller", {
        p_city: (L.city ?? "").trim(),
        p_seller_lat: L.lat,
        p_seller_lng: L.lng,
        p_radius_km: L.radius_km,
        p_limit: 50,
      });
      if (error) throw error;
      setItems((data ?? []) as any);
    } catch (e: any) {
      alert(e.message ?? "Failed to refresh feed");
    } finally {
      setBusyFeed(false);
    }
  }

  async function refreshOrders() {
    setBusyOrders(true);
    try {
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) return;

      const { data, error } = await supabase
        .from("orders")
        .select("id, request_id, status, created_at")
        .eq("seller_id", user.id)
        .eq("status", "locked")
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      setOrders((data ?? []) as any);
    } catch (e: any) {
      alert(e.message ?? "Failed to refresh orders");
    } finally {
      setBusyOrders(false);
    }
  }

  async function openOfferSheet(r: VisibleReq) {
    setOfferReq(r);
    setOfferOpen(true);
  }

  async function submitOffer(payload: {
    message: string;
    price_total: number | null;
    delivery_fee: number | null;
    fulfillment: "delivery" | "pickup";
    eta_minutes: number | null;
  }) {
    if (!offerReq) return;

    const { error } = await supabase.rpc("send_or_update_offer", {
      p_request_id: offerReq.request_id,
      p_message: payload.message,
      p_price_total: payload.price_total,
      p_delivery_fee: payload.delivery_fee,
      p_fulfillment: payload.fulfillment,
      p_eta_minutes: payload.eta_minutes,
    });

    if (error) {
      alert(error.message);
      return;
    }

    setOfferOpen(false);
    await refreshFeed();
    await refreshOrders();
  }

  if (!loc) {
    return (
      <div className="mx-auto max-w-md px-4 py-6">
        <div className="text-sm font-medium text-zinc-900">Set your location</div>
        <div className="mt-1 text-xs text-zinc-500">
          Seller requires location + radius. Go to Settings and save your active location.
        </div>
        <Link to="/seller/settings" className="mt-4 inline-flex rounded-full bg-black text-white px-4 py-2 text-sm">
          Open Settings
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-zinc-900">Seller</div>
          <div className="text-xs text-zinc-500">Requests near you (locality only)</div>
        </div>
        <button
          onClick={refreshAll}
          className="rounded-full bg-black px-3 py-1 text-xs text-white"
          disabled={busyFeed || busyOrders}
        >
          {busyFeed || busyOrders ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* Seller config */}
      <div className="border border-zinc-200 rounded-2xl p-3">
        <div className="grid grid-cols-2 gap-2">
          <input
            value={loc.city}
            onChange={(e) => setLoc({ ...loc, city: e.target.value } as any)}
            className="border border-zinc-200 rounded-xl px-3 py-2 text-xs outline-none"
            placeholder="City"
          />
          <input
            value={loc.radius_km}
            onChange={(e) => setLoc({ ...loc, radius_km: Number(e.target.value || 3) } as any)}
            className="border border-zinc-200 rounded-xl px-3 py-2 text-xs outline-none"
            placeholder="Radius km"
            type="number"
            min={1}
            step={0.5}
          />
          <input
            value={loc.lat ?? ""}
            onChange={(e) => setLoc({ ...loc, lat: Number(e.target.value) } as any)}
            className="border border-zinc-200 rounded-xl px-3 py-2 text-xs outline-none"
            placeholder="Lat"
          />
          <input
            value={loc.lng ?? ""}
            onChange={(e) => setLoc({ ...loc, lng: Number(e.target.value) } as any)}
            className="border border-zinc-200 rounded-xl px-3 py-2 text-xs outline-none"
            placeholder="Lng"
          />
        </div>

        <div className="mt-2 flex items-center justify-between">
          <button onClick={useDeviceLocation} className="text-xs text-zinc-600">
            Use device location
          </button>

          <button
            onClick={async () => {
              await saveSellerLocation({
                city: (loc.city ?? "").trim(),
                lat: loc.lat,
                lng: loc.lng,
                radius_km: loc.radius_km,
              });
              const latest = await ensureSellerLocation();
              await refreshFeed(latest);
            }}
            className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-800"
          >
            Save
          </button>
        </div>

        <div className="mt-2 text-[11px] text-zinc-500">
          Privacy: you see only locality + approx distance until a user accepts your offer.
        </div>
      </div>

      {/* Requests feed */}
      <div className="mt-4">
        <div className="mb-2 text-sm font-medium text-zinc-900">Requests</div>

        {feedEmptyText ? (
          <div className="text-xs text-zinc-500">{feedEmptyText}</div>
        ) : (
          <div className="space-y-2">
            {items.map((r) => (
              <div key={r.request_id} className="border border-zinc-200 rounded-2xl p-3">
                <div className="text-xs text-zinc-500">
                  {r.category} • {r.public_area} • ~{Number(r.distance_km).toFixed(1)} km
                </div>
                <div className="mt-1 text-sm text-zinc-900">{r.text}</div>

                <div className="mt-2 flex items-center justify-between">
                  <div className="text-xs text-zinc-600">
                    {r.mode === "later" && r.scheduled_at
                      ? `Later • ${new Date(r.scheduled_at).toLocaleString()}`
                      : r.mode === "takeaway"
                      ? "Takeaway"
                      : "Now"}
                  </div>
                  <button
                    className="rounded-full bg-black text-white px-3 py-1 text-xs"
                    onClick={() => openOfferSheet(r)}
                  >
                    Respond
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Active orders */}
      <div className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-medium text-zinc-900">My active orders</div>
          <button
            onClick={refreshOrders}
            className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-800"
            disabled={busyOrders}
          >
            {busyOrders ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {orders.length === 0 ? (
          <div className="text-xs text-zinc-500">None yet.</div>
        ) : (
          <div className="space-y-2">
            {orders.map((o) => (
              <Link key={o.id} to={`/seller/order/${o.id}`} className="block border border-zinc-200 rounded-2xl p-3">
                <div className="text-xs text-zinc-500">Order • {o.id.slice(0, 8)}</div>
                <div className="mt-1 text-sm text-zinc-900">
                  Status: <span className="font-medium">{o.status}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <OfferSheet open={offerOpen} onClose={() => setOfferOpen(false)} requestText={offerReq?.text ?? ""} onSubmit={submitOffer} />
    </div>
  );
}
