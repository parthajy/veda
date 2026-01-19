// /Users/partha/Desktop/veda/veda-web/src/pages/SellerSettingsPage.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { signOut } from "../lib/auth";
import { supabase } from "../lib/supabase";
import { MapPin, Save, LogOut, Store, Phone, User2 } from "lucide-react";

type SellerLoc = {
  id: string;
  city: string | null;
  lat: number | null;
  lng: number | null;
  radius_km: number | null;
};

type SellerProfile = {
  id: string;
  display_name: string | null;
  store_name: string | null;
  phone: string | null;
};

function clampRadius(v: number) {
  if (!Number.isFinite(v)) return 3;
  return Math.min(25, Math.max(1, v));
}

export default function SellerSettingsPage() {
  const nav = useNavigate();
  const [profile, setProfile] = useState<SellerProfile | null>(null);
  const [loc, setLoc] = useState<SellerLoc | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const [allCats, setAllCats] = useState<any[]>([]);
  const [selectedCats, setSelectedCats] = useState<Set<string>>(new Set());

  useEffect(() => {
  (async () => {
    const user = (await supabase.auth.getUser()).data.user;
    if (!user) return;

    const { data: cats } = await supabase.from("categories").select("id,name").order("sort_order", { ascending: true });
    setAllCats(cats ?? []);

    const { data: my } = await supabase
      .from("seller_categories")
      .select("category_id")
      .eq("seller_id", user.id);

    setSelectedCats(new Set(my?.map((d: any) => d.category_id) ?? []));
  })();
}, []);

  const canSave = useMemo(() => {
    if (!profile || !loc) return false;
    const hasBasics = (profile.display_name ?? "").trim().length > 0 && (profile.store_name ?? "").trim().length > 0;
    const hasPhone = (profile.phone ?? "").trim().length >= 8;

    const hasServiceArea =
      (loc.city ?? "").trim().length > 0 && loc.lat != null && loc.lng != null && (loc.radius_km ?? 0) > 0;

    return hasBasics && hasPhone && hasServiceArea && !busy;
  }, [profile, loc, busy]);

  useEffect(() => {
    load()
      .catch((e) => alert(e.message ?? "Failed to load settings"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoading(true);
    const user = (await supabase.auth.getUser()).data.user;
    if (!user) return;

    const { data: p, error: pErr } = await supabase
      .from("profiles")
      .select("id, display_name, store_name, phone")
      .eq("id", user.id)
      .maybeSingle();
    if (pErr) throw pErr;
    setProfile((p as any) ?? { id: user.id, display_name: null, store_name: null, phone: null });

    const { data: existing, error: locErr } = await supabase
      .from("seller_locations")
      .select("id, city, lat, lng, radius_km")
      .eq("seller_id", user.id)
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (locErr) throw locErr;

    if (existing) {
      setLoc(existing as any);
      return;
    }

    const { data: created, error: insErr } = await supabase
      .from("seller_locations")
      .insert({
        seller_id: user.id,
        city: "",
        lat: null,
        lng: null,
        radius_km: 3,
        active: true,
      })
      .select("id, city, lat, lng, radius_km")
      .single();

    if (insErr) throw insErr;
    setLoc(created as any);
  }

  async function useDeviceLocation() {
    if (!loc) return;
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLoc({ ...loc, lat: pos.coords.latitude, lng: pos.coords.longitude });
        setBusy(false);
      },
      () => {
        alert("Location permission denied.");
        setBusy(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  async function saveAll() {
    if (!profile || !loc) return;

    setBusy(true);
    try {
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) throw new Error("No user");

      const { error: pErr } = await supabase
        .from("profiles")
        .update({
          display_name: (profile.display_name ?? "").trim(),
          store_name: (profile.store_name ?? "").trim(),
          phone: (profile.phone ?? "").trim(),
        })
        .eq("id", user.id);

      if (pErr) throw pErr;

      const { error: lErr } = await supabase
        .from("seller_locations")
        .update({
          city: (loc.city ?? "").trim(),
          lat: loc.lat,
          lng: loc.lng,
          radius_km: clampRadius(Number(loc.radius_km)),
          active: true,
        })
        .eq("id", loc.id);

      if (lErr) throw lErr;

      await supabase.from("seller_categories").delete().eq("seller_id", user.id);

      if (selectedCats.size > 0) {
        await supabase.from("seller_categories").insert(
          Array.from(selectedCats).map((cid) => ({
            seller_id: user.id,
            category_id: cid,
          }))
        );
      }

      nav("/seller/feed");
    } catch (e: any) {
      alert(e.message ?? "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !profile || !loc) {
    return (
      <div className="mx-auto max-w-md px-4 py-5">
        <div className="text-sm text-zinc-600">Loading…</div>
      </div>
    );
  }

  const radius = Number(loc.radius_km ?? 3);

  return (
    <div className="mx-auto max-w-md px-4 py-5">
      <div className="mb-4 flex items-center justify-between">
        <button className="text-xs text-zinc-600" onClick={() => nav("/seller")}>
          ← Back
        </button>
        <div className="text-sm font-medium text-zinc-900">Settings</div>
        <button
          className="text-xs text-zinc-600 inline-flex items-center gap-1"
          onClick={async () => {
            await signOut();
            nav("/");
          }}
          title="Sign out"
        >
          <LogOut size={14} />
          Sign out
        </button>
      </div>

      {/* Store profile */}
      <div className="border border-zinc-200 rounded-2xl p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-zinc-900">Store profile</div>
            <div className="mt-0.5 text-[11px] text-zinc-500">Shown to buyers after you respond/accept.</div>
          </div>
          <Store className="text-zinc-400" size={18} />
        </div>

        <div className="mt-3 space-y-2">
          <label className="block">
            <div className="text-[11px] text-zinc-500 mb-1 inline-flex items-center gap-2">
              <User2 size={14} /> Your name
            </div>
            <input
              value={profile.display_name ?? ""}
              onChange={(e) => setProfile({ ...profile, display_name: e.target.value })}
              className="w-full border border-zinc-200 rounded-xl px-3 py-2 text-sm outline-none"
              placeholder="e.g. Partha"
            />
          </label>

          <label className="block">
            <div className="text-[11px] text-zinc-500 mb-1 inline-flex items-center gap-2">
              <Store size={14} /> Store name
            </div>
            <input
              value={profile.store_name ?? ""}
              onChange={(e) => setProfile({ ...profile, store_name: e.target.value })}
              className="w-full border border-zinc-200 rounded-xl px-3 py-2 text-sm outline-none"
              placeholder="e.g. Jorhat Fashion Hub"
            />
          </label>

          <label className="block">
            <div className="text-[11px] text-zinc-500 mb-1 inline-flex items-center gap-2">
              <Phone size={14} /> Phone number
            </div>
            <input
              value={profile.phone ?? ""}
              onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
              className="w-full border border-zinc-200 rounded-xl px-3 py-2 text-sm outline-none"
              placeholder="e.g. +91 98xxxxxx"
              inputMode="tel"
            />
          </label>
        </div>
      </div>

      {/* Service area */}
      <div className="mt-4 border border-zinc-200 rounded-2xl p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-zinc-900">Service area</div>
            <div className="mt-0.5 text-[11px] text-zinc-500">Your feed is based on city + (lat,lng) + radius.</div>
          </div>
          <MapPin className="text-zinc-400" size={18} />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <input
            value={loc.city ?? ""}
            onChange={(e) => setLoc({ ...loc, city: e.target.value })}
            className="border border-zinc-200 rounded-xl px-3 py-2 text-xs outline-none"
            placeholder="City (required)"
          />

          {/* Number input */}
          <input
            value={radius}
            onChange={(e) =>
  setLoc({
    ...loc,
    radius_km: clampRadius(Number(e.target.value)),
  })
}
            className="border border-zinc-200 rounded-xl px-3 py-2 text-xs outline-none"
            placeholder="Radius km"
            type="number"
            min={1}
            max={25}
            step={0.5}
          />

          <input
            value={loc.lat ?? ""}
            onChange={(e) => setLoc({ ...loc, lat: e.target.value === "" ? null : Number(e.target.value) })}
            className="border border-zinc-200 rounded-xl px-3 py-2 text-xs outline-none"
            placeholder="Lat"
          />
          <input
            value={loc.lng ?? ""}
            onChange={(e) => setLoc({ ...loc, lng: e.target.value === "" ? null : Number(e.target.value) })}
            className="border border-zinc-200 rounded-xl px-3 py-2 text-xs outline-none"
            placeholder="Lng"
          />
        </div>

        {/* Slider */}
        <div className="mt-3 rounded-2xl border border-zinc-200 bg-white p-3">
          <div className="flex items-center justify-between">
            <div className="text-xs text-zinc-600">Delivery radius</div>
            <div className="text-xs font-medium text-zinc-900">{radius.toFixed(1)} km</div>
          </div>
          <input
            type="range"
            min={1}
            max={25}
            step={0.5}
            value={radius}
            onChange={(e) =>
  setLoc({
    ...loc,
    radius_km: clampRadius(Number(e.target.value)),
  })
}
            className="mt-2 w-full"
          />
          <div className="mt-1 flex justify-between text-[10px] text-zinc-500">
            <span>1km</span>
            <span>25km</span>
          </div>
        </div>

        <div className="mt-4 border rounded-2xl p-3">
          <div className="text-sm font-medium">Categories you sell</div>
          <div className="mt-2 space-y-1">
            {allCats.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={selectedCats.has(c.id)}
                  onChange={(e) => {
                    const next = new Set(selectedCats);
                    e.target.checked ? next.add(c.id) : next.delete(c.id);
                    setSelectedCats(next);
                  }}
                />
                {c.name}
              </label>
            ))}
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between">
          <button onClick={useDeviceLocation} className="text-xs text-zinc-600" disabled={busy}>
            {busy ? "Getting…" : "Use device location"}
          </button>

          <div className="text-[11px] text-zinc-500">
            Tip: Start with <span className="text-zinc-700">3km</span> and increase if needed.
          </div>
        </div>
      </div>

      <button
        onClick={saveAll}
        disabled={!canSave || busy}
        className={[
          "mt-4 w-full rounded-2xl py-3 text-sm inline-flex items-center justify-center gap-2",
          !canSave || busy ? "bg-zinc-200 text-zinc-500" : "bg-black text-white",
        ].join(" ")}
      >
        <Save size={16} />
        {busy ? "Saving…" : "Save changes"}
      </button>

      {!canSave ? (
        <div className="mt-2 text-[11px] text-amber-700">
          Required: your name, store name, phone, and service area (city + GPS + radius).
        </div>
      ) : null}
    </div>
  );
}
