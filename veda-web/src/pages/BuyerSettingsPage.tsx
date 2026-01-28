// /Users/partha/Desktop/veda/veda-web/src/pages/BuyerSettingsPage.tsx
import { useEffect, useMemo, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import { useNavigate } from "react-router-dom";
import { signOut } from "../lib/auth";
import { supabase } from "../lib/supabase";

const LS_LOC_KEY = "veda:buyer_location";

type BuyerLoc = {
  city: string;
  public_area: string;
  lat: number | null;
  lng: number | null;
};

type BuyerProfile = {
  id: string;
  display_name: string | null;
  phone: string | null; // from auth, show read-only
};

function safeParseLoc(raw: string | null): BuyerLoc | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (!v) return null;
    return {
      city: typeof v.city === "string" ? v.city : "",
      public_area: typeof v.public_area === "string" ? v.public_area : "",
      lat: typeof v.lat === "number" ? v.lat : null,
      lng: typeof v.lng === "number" ? v.lng : null,
    };
  } catch {
    return null;
  }
}

export default function BuyerSettingsPage() {
  const nav = useNavigate();

  const [loc, setLoc] = useState<BuyerLoc>({ city: "", public_area: "", lat: null, lng: null });
  const [profile, setProfile] = useState<BuyerProfile | null>(null);

  const [busy, setBusy] = useState(false);
  const [locBusy, setLocBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const hasGps = loc.lat != null && loc.lng != null;
  const hasLocality = (loc.city ?? "").trim().length > 0 && (loc.public_area ?? "").trim().length > 0;

  const canSave = useMemo(() => {
    const nameOk = (profile?.display_name ?? "").trim().length > 0;
    return nameOk && hasLocality && hasGps && !busy;
  }, [profile, hasLocality, hasGps, busy]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // 1) Load location from localStorage
        const saved = safeParseLoc(localStorage.getItem(LS_LOC_KEY));
        if (saved) setLoc(saved);

        // 2) Load / init profile from DB
        const user = (await supabase.auth.getUser()).data.user;
        if (!user) {
          setProfile(null);
          return;
        }

        const { data, error } = await supabase
          .from("profiles")
          .select("id, display_name, phone")
          .eq("id", user.id)
          .maybeSingle();

        if (error) throw error;

        setProfile(
          (data as any) ?? {
            id: user.id,
            display_name: "",
            phone: user.phone ?? "",
          }
        );
      } catch (e: any) {
        alert(e.message ?? "Failed to load settings");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function persistLocation(next?: Partial<BuyerLoc>) {
    const merged: BuyerLoc = { ...loc, ...(next ?? {}) };
    localStorage.setItem(LS_LOC_KEY, JSON.stringify(merged));
  }

  async function useDeviceLocation() {
    setLocBusy(true);
    try {
      const { lat, lng } = await getGpsOrThrow();
      const next = { ...loc, lat, lng };
      setLoc(next);
      persistLocation({ lat, lng });
    } catch (e: any) {
      alert(e?.message ?? "Location permission denied.");
    } finally {
      setLocBusy(false);
    }
  }

  async function getGpsOrThrow(): Promise<{ lat: number; lng: number }> {
    if (Capacitor.isNativePlatform()) {
      const perm = await Geolocation.requestPermissions();

      const locPerm = (perm as any).location ?? (perm as any).coarseLocation ?? (perm as any).fineLocation;

      if (locPerm && String(locPerm).toLowerCase() !== "granted") {
        throw new Error("Location permission denied. Enable Location permission for the app.");
      }

      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 8000,
      });

      return { lat: pos.coords.latitude, lng: pos.coords.longitude };
    }

    return await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => reject(new Error("Location permission denied.")),
        { enableHighAccuracy: true, timeout: 8000 }
      );
    });
  }

  async function saveAll() {
    if (!profile) return;

    setBusy(true);
    try {
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) throw new Error("No user");

      const cleanLoc: BuyerLoc = {
        city: (loc.city ?? "").trim(),
        public_area: (loc.public_area ?? "").trim(),
        lat: loc.lat,
        lng: loc.lng,
      };
      localStorage.setItem(LS_LOC_KEY, JSON.stringify(cleanLoc));

      // ✅ IMPORTANT: upsert so first-time users create the row
      // Phone is verified via OTP auth and should NOT be manually edited here.
      const { error } = await supabase
        .from("profiles")
        .upsert(
          {
            id: user.id,
            display_name: (profile.display_name ?? "").trim(),
          },
          { onConflict: "id" }
        );

      if (error) throw error;

      nav("/");
    } catch (e: any) {
      alert(e.message ?? "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !profile) {
    return (
      <div className="mx-auto max-w-md px-4 py-5">
        <div className="text-sm text-zinc-600">Loading…</div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-5">
      <div className="mb-4 flex items-center justify-between">
        <button className="text-xs text-zinc-600" onClick={() => nav("/")}>
          ← Back
        </button>
        <div className="text-sm font-medium text-zinc-900">Settings</div>
        <button
          className="text-xs text-zinc-600"
          onClick={async () => {
            await signOut();
            nav("/");
          }}
        >
          Sign out
        </button>
      </div>

      {/* Buyer profile */}
      <div className="border border-zinc-200 rounded-2xl p-3">
        <div className="text-sm font-medium text-zinc-900">Your details</div>
        <div className="mt-0.5 text-[11px] text-zinc-500">Shared with seller only after you accept an offer.</div>

        <div className="mt-3 space-y-2">
          <label className="block">
            <div className="text-[11px] text-zinc-500 mb-1">Name</div>
            <input
              value={profile.display_name ?? ""}
              onChange={(e) => setProfile({ ...profile, display_name: e.target.value })}
              className="w-full border border-zinc-200 rounded-xl px-3 py-2 text-sm outline-none"
              placeholder="e.g. Partha"
            />
          </label>

          <label className="block">
            <div className="text-[11px] text-zinc-500 mb-1">Phone (verified)</div>
            <input
              value={profile.phone ?? ""}
              readOnly
              className="w-full border border-zinc-200 rounded-xl px-3 py-2 text-sm outline-none bg-zinc-50 text-zinc-700"
              placeholder="Verified phone will appear here"
              inputMode="tel"
            />
            <div className="mt-1 text-[11px] text-zinc-500">
              Phone is from OTP login. No manual entry needed.
            </div>
          </label>
        </div>
      </div>

      {/* Location */}
      <div className="mt-4 border border-zinc-200 rounded-2xl p-3">
        <div className="text-sm font-medium text-zinc-900">Location</div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <input
            value={loc.city ?? ""}
            onChange={(e) => {
              const next = { ...loc, city: e.target.value };
              setLoc(next);
              persistLocation({ city: e.target.value });
            }}
            className="border border-zinc-200 rounded-xl px-3 py-2 text-xs outline-none"
            placeholder="City"
          />
          <input
            value={loc.public_area ?? ""}
            onChange={(e) => {
              const next = { ...loc, public_area: e.target.value };
              setLoc(next);
              persistLocation({ public_area: e.target.value });
            }}
            className="border border-zinc-200 rounded-xl px-3 py-2 text-xs outline-none"
            placeholder="Locality"
          />
          <input
            value={loc.lat ?? ""}
            onChange={(e) => setLoc({ ...loc, lat: e.target.value ? Number(e.target.value) : null })}
            className="border border-zinc-200 rounded-xl px-3 py-2 text-xs outline-none"
            placeholder="Lat"
          />
          <input
            value={loc.lng ?? ""}
            onChange={(e) => setLoc({ ...loc, lng: e.target.value ? Number(e.target.value) : null })}
            className="border border-zinc-200 rounded-xl px-3 py-2 text-xs outline-none"
            placeholder="Lng"
          />
        </div>

        <div className="mt-2 flex items-center justify-between">
          <button onClick={useDeviceLocation} className="text-xs text-zinc-600" disabled={locBusy}>
            {locBusy ? "Getting…" : hasGps ? "GPS saved" : "Use device location"}
          </button>

          <button
            onClick={saveAll}
            disabled={!canSave || busy}
            className={[
              "rounded-full px-3 py-1 text-xs",
              !canSave || busy ? "bg-zinc-200 text-zinc-500" : "bg-black text-white",
            ].join(" ")}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>

        {!canSave ? (
          <div className="mt-2 text-[11px] text-amber-700">Required: name, city + locality, GPS.</div>
        ) : null}

        <div className="mt-2 text-[11px] text-zinc-500">
          Sellers only see your locality until you accept an offer.
        </div>
      </div>

      <div className="mt-4 border border-zinc-200 rounded-2xl p-3">
        <div className="text-sm font-medium text-zinc-900">Order history</div>
        <div className="mt-2 text-xs text-zinc-500">For MVP, history is your Threads list (fulfilled/cancelled show there).</div>
      </div>
    </div>
  );
}
