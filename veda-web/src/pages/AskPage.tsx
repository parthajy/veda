// /Users/partha/Desktop/veda/veda-web/src/pages/AskPage.tsx
import { useEffect, useMemo, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

type Mode = "now" | "later" | "takeaway";

const LS_LOC_KEY = "veda:buyer_location";

type BuyerLoc = {
  city: string;
  public_area: string;
  lat: number | null;
  lng: number | null;
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

async function getGpsOrThrow(): Promise<{ lat: number; lng: number }> {
  // Prefer Capacitor when running on device / emulator
  if (Capacitor.isNativePlatform()) {
    const perm = await Geolocation.requestPermissions();

    const locPerm =
      (perm as any).location ??
      (perm as any).coarseLocation ??
      (perm as any).fineLocation;

    // Capacitor returns strings like "granted" / "denied" depending on platform
    if (locPerm && String(locPerm).toLowerCase() !== "granted") {
      throw new Error("Location permission denied. Enable Location permission for the app.");
    }

    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 8000,
    });

    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  }

  // Web fallback
  return await new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => reject(new Error("Location permission denied. GPS is required to place a request.")),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });
}

export default function AskPage() {
  const nav = useNavigate();

  const [text, setText] = useState("");
  const [mode, setMode] = useState<Mode>("now");
  const [scheduledAt, setScheduledAt] = useState<string>("");

  // Categories
  const [cats, setCats] = useState<{ id: string; name: string }[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);

  // Location-first (no defaults)
  const [city, setCity] = useState("");
  const [publicArea, setPublicArea] = useState("");
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);

  const [busy, setBusy] = useState(false);
  const [locBusy, setLocBusy] = useState(false);

  // Load categories once
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("categories")
        .select("id,name")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });

      if (cancelled) return;

      if (error) {
        console.error(error);
        setCats([]);
        setCategoryId(null);
        return;
      }

      const rows = (data ?? []) as { id: string; name: string }[];
      setCats(rows);
      if (rows[0]?.id) setCategoryId((prev) => prev ?? rows[0].id);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Load saved location
  useEffect(() => {
    const saved = safeParseLoc(localStorage.getItem(LS_LOC_KEY));
    if (saved) {
      setCity(saved.city);
      setPublicArea(saved.public_area);
      setLat(saved.lat);
      setLng(saved.lng);
    }
  }, []);

  const hasGps = lat != null && lng != null;
  const hasLocality = city.trim().length > 0 && publicArea.trim().length > 0;

  const canSend = useMemo(() => {
    return text.trim().length >= 3 && hasLocality && hasGps && !busy;
  }, [text, hasLocality, hasGps, busy]);

  function persistLocation(next?: Partial<BuyerLoc>) {
    const current: BuyerLoc = {
      city: city.trim(),
      public_area: publicArea.trim(),
      lat,
      lng,
    };
    const merged: BuyerLoc = { ...current, ...(next ?? {}) };
    localStorage.setItem(LS_LOC_KEY, JSON.stringify(merged));
  }

  async function useDeviceLocation() {
  setLocBusy(true);
  try {
    const { lat: nextLat, lng: nextLng } = await getGpsOrThrow();
    setLat(nextLat);
    setLng(nextLng);
    persistLocation({ lat: nextLat, lng: nextLng });
  } catch (e: any) {
    alert(e?.message ?? "Location permission denied. GPS is required to place a request.");
  } finally {
    setLocBusy(false);
  }
}

  async function submit() {
    if (!canSend) return;

    setBusy(true);
    try {
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) throw new Error("No user");

      if (!categoryId) throw new Error("Pick a category");
      const picked = cats.find((c) => c.id === categoryId);
      if (!picked) throw new Error("Pick a category");

      if (lat == null || lng == null) throw new Error("GPS required");
      if (!city.trim() || !publicArea.trim()) throw new Error("City + Locality required");

      persistLocation({
        city: city.trim(),
        public_area: publicArea.trim(),
        lat,
        lng,
      });

      const { data, error } = await supabase
        .from("requests")
        .insert({
          user_id: user.id,
          category: picked.name, // ✅ REQUIRED (requests.category is NOT NULL)
          category_id: categoryId, // ✅ keep for filtering / future FK
          text: text.trim(),
          mode,
          scheduled_at: mode === "later" && scheduledAt ? new Date(scheduledAt).toISOString() : null,
          city: city.trim(),
          public_area: publicArea.trim(),
          lat,
          lng,
          status: "open",
        })
        .select("id")
        .single();

      if (error) throw error;
      nav(`/t/${data.id}`);
    } catch (e: any) {
      alert(e.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="leading-tight">
          <div className="text-sm font-medium text-zinc-900">New request</div>
          <div className="text-xs text-zinc-500">Locality-first. Fast. Simple.</div>
        </div>
        <button onClick={() => nav("/")} className="text-xs text-zinc-600" type="button">
          Close
        </button>
      </div>

      {/* Category chips */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {cats.map((c) => (
          <button
            key={c.id}
            onClick={() => setCategoryId(c.id)}
            type="button"
            className={[
              "shrink-0 rounded-full px-3 py-1.5 text-xs border transition",
              categoryId === c.id
                ? "bg-black text-white border-black"
                : "bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50",
            ].join(" ")}
          >
            {c.name}
          </button>
        ))}
      </div>

      <div className="mt-3 rounded-3xl border border-zinc-200 bg-white p-4">
        <div className="text-xs text-zinc-500">What do you need?</div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder={`Type naturally…\nExample: "Need 30 pcs paneer today by 7pm"`}
          className="mt-2 w-full resize-none outline-none text-[15px] leading-snug text-zinc-900"
        />

        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex gap-2">
            <ModePill label="Now" active={mode === "now"} onClick={() => setMode("now")} />
            <ModePill label="Later" active={mode === "later"} onClick={() => setMode("later")} />
            <ModePill label="Takeaway" active={mode === "takeaway"} onClick={() => setMode("takeaway")} />
          </div>

          <button
            className="text-xs text-zinc-700 rounded-full border border-zinc-200 px-3 py-1.5 hover:bg-zinc-50"
            onClick={useDeviceLocation}
            type="button"
            disabled={locBusy}
          >
            {locBusy ? "Getting…" : hasGps ? "GPS saved" : "Use GPS"}
          </button>
        </div>

        {mode === "later" && (
          <div className="mt-3">
            <div className="text-xs text-zinc-500 mb-1">When?</div>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="w-full border border-zinc-200 rounded-2xl px-3 py-3 text-sm outline-none"
            />
          </div>
        )}

        <div className="mt-4">
          <div className="flex items-center justify-between">
            <div className="text-xs text-zinc-500">Where?</div>
            <div className="text-[11px] text-zinc-500">
              Sellers see only <span className="text-zinc-700">locality</span> until accept
            </div>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-2">
            <input
              value={city}
              onChange={(e) => {
                setCity(e.target.value);
                persistLocation({ city: e.target.value });
              }}
              className="border border-zinc-200 rounded-2xl px-3 py-3 text-sm outline-none"
              placeholder="City"
            />
            <input
              value={publicArea}
              onChange={(e) => {
                setPublicArea(e.target.value);
                persistLocation({ public_area: e.target.value });
              }}
              className="border border-zinc-200 rounded-2xl px-3 py-3 text-sm outline-none"
              placeholder="Locality (public)"
            />
          </div>

          <div className="mt-2 flex items-center gap-2 text-[11px]">
            <span
              className={[
                "px-2 py-0.5 rounded-full border",
                hasLocality
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-amber-200 bg-amber-50 text-amber-700",
              ].join(" ")}
            >
              {hasLocality ? "Locality ok" : "City + locality required"}
            </span>

            <span
              className={[
                "px-2 py-0.5 rounded-full border",
                hasGps
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-amber-200 bg-amber-50 text-amber-700",
              ].join(" ")}
            >
              {hasGps ? "GPS ok" : "GPS required"}
            </span>
          </div>
        </div>

        <button
          disabled={!canSend || busy}
          onClick={submit}
          type="button"
          className={[
            "mt-4 w-full rounded-2xl py-3 text-sm font-medium transition",
            !canSend || busy ? "bg-zinc-200 text-zinc-500" : "bg-black text-white hover:opacity-95",
          ].join(" ")}
        >
          {busy ? "Sending…" : "Ask"}
        </button>
      </div>
    </div>
  );
}

function ModePill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      type="button"
      className={[
        "rounded-full px-3 py-1.5 text-xs border transition",
        active ? "bg-black text-white border-black" : "bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50",
      ].join(" ")}
    >
      {label}
    </button>
  );
}
