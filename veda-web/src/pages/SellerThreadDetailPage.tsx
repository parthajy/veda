// /Users/partha/Desktop/veda/veda-web/src/pages/SellerThreadDetailPage.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";

type SellerReq = {
  request_id: string;
  status: "open" | "locked" | "fulfilled" | "cancelled";
  category: string;
  text: string;
  mode: "now" | "later" | "takeaway";
  scheduled_at: string | null;
  city: string;
  public_area: string;
  lat: number | null;
  lng: number | null;
  locked_to_me: boolean;
  created_at: string;
};

type OfferRow = {
  id: string;
  request_id: string;
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
  from_role: "user" | "seller";
  from_id: string;
  body: string;
  created_at: string;
};

type OrderRow = {
  id: string;
  request_id: string;
  status: "locked" | "fulfilled" | "cancelled";
  created_at: string;
};

type ThreadPhotoRow = {
  id: string;
  request_id: string;
  uploader_id: string;
  uploader_role: "buyer" | "seller" | string;
  storage_path: string;
  created_at: string;
};

export default function SellerThreadDetailPage() {
  const { requestId } = useParams();
  const nav = useNavigate();

  const [tab, setTab] = useState<"details" | "chat">("details");
  const [req, setReq] = useState<SellerReq | null>(null);
  const [myOffer, setMyOffer] = useState<OfferRow | null>(null);
  const [msgs, setMsgs] = useState<MsgRow[]>([]);
  const [order, setOrder] = useState<OrderRow | null>(null);

  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  // Fulfillment (PIN)
  const [pin, setPin] = useState("");
  const [fulfilling, setFulfilling] = useState(false);
  const [pinOk, setPinOk] = useState<boolean | null>(null);

  // Photos
  const [meId, setMeId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<ThreadPhotoRow[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const didInit = useRef(false);

  useEffect(() => {
    if (!requestId) return;
    if (didInit.current) return;
    didInit.current = true;

    (async () => {
      const user = (await supabase.auth.getUser()).data.user;
      setMeId(user?.id ?? null);

      await refreshAll();
      await markRead();

      const ch = supabase
        .channel(`seller_thread_${requestId}`)
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
            await refreshOffer();
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
          { event: "*", schema: "public", table: "thread_photos", filter: `request_id=eq.${requestId}` },
          async () => {
            await refreshPhotos();
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
      await Promise.all([refreshReq(), refreshOffer(), refreshMessages(), refreshOrder(), refreshPhotos()]);
    } finally {
      setBusy(false);
    }
  }

  async function refreshReq() {
    if (!requestId) return;
    const { data, error } = await supabase.rpc("get_thread_details_for_seller", { p_request_id: requestId });
    if (error) throw error;
    const row = (data ?? [])[0];
    if (!row) {
      setReq(null);
      return;
    }
    setReq((row as any) ?? null);
  }

  async function refreshOffer() {
    if (!requestId) return;
    const user = (await supabase.auth.getUser()).data.user;
    if (!user) return;

    const { data, error } = await supabase
      .from("offers")
      .select("id, request_id, message, price_total, delivery_fee, fulfillment, eta_minutes, status, created_at")
      .eq("request_id", requestId)
      .eq("seller_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    setMyOffer((data as any) ?? null);
  }

  async function refreshMessages() {
    if (!requestId) return;
    const user = (await supabase.auth.getUser()).data.user;
    if (!user) return;

    const { data, error } = await supabase
      .from("messages")
      .select("id, request_id, seller_id, from_role, from_id, body, created_at")
      .eq("request_id", requestId)
      .eq("seller_id", user.id)
      .order("created_at", { ascending: true });

    if (error) throw error;
    setMsgs((data ?? []) as any);
  }

  async function refreshOrder() {
    if (!requestId) return;
    const { data, error } = await supabase
      .from("orders")
      .select("id, request_id, status, created_at")
      .eq("request_id", requestId)
      .maybeSingle();

    if (error) throw error;
    setOrder((data as any) ?? null);
  }

  async function refreshPhotos() {
    if (!requestId) return;

    // IMPORTANT: select storage_path (NOT url)
    const { data, error } = await supabase
      .from("thread_photos")
      .select("id, request_id, uploader_id, uploader_role, storage_path, created_at")
      .eq("request_id", requestId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("refreshPhotos", error);
      return;
    }

    const rows = (data ?? []) as any as ThreadPhotoRow[];
    setPhotos(rows);

    // refresh signed URLs
    const next: Record<string, string> = {};
    for (const p of rows) {
      // keep existing URL if present (avoid re-signing too often)
      if (photoUrls[p.id]) {
        next[p.id] = photoUrls[p.id];
        continue;
      }
      const { data: signed, error: signErr } = await supabase.storage
        .from("thread-photos")
        .createSignedUrl(p.storage_path, 60 * 60); // 1 hour
      if (!signErr && signed?.signedUrl) next[p.id] = signed.signedUrl;
    }
    setPhotoUrls((prev) => ({ ...prev, ...next }));
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

    setSending(true);
    try {
      const { error } = await supabase.from("messages").insert({
        request_id: requestId,
        seller_id: user.id,
        from_role: "seller",
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

  function openMaps() {
    if (!req?.lat || !req?.lng) return;
    const lat = req.lat;
    const lng = req.lng;
    const url = `https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function fulfillWithPin() {
    if (!order?.id) return;
    const p = pin.trim();
    if (p.length < 4) return;

    setFulfilling(true);
    setPinOk(null);
    try {
      const { data, error } = await supabase.rpc("fulfill_order_with_pin", {
        p_order_id: order.id,
        p_pin: p,
      });

      if (error) throw error;

      const ok = !!data;
      setPinOk(ok);
      if (ok) {
        setPin("");
        await Promise.all([refreshOrder(), refreshReq()]);
      }
    } catch (e: any) {
      alert(e.message ?? "Failed");
    } finally {
      setFulfilling(false);
    }
  }

  function choosePhoto() {
    if (uploadingPhoto) return;
    if (photos.length >= 3) return;
    fileRef.current?.click();
  }

  async function uploadPhoto(file: File) {
    if (!requestId) return;
    const user = (await supabase.auth.getUser()).data.user;
    if (!user) return;

    if (photos.length >= 3) {
      alert("Max 3 photos per thread.");
      return;
    }

    setUploadingPhoto(true);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const safeExt = ["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "jpg";
      const objName = `${requestId}/${user.id}/${crypto.randomUUID()}.${safeExt}`;

      // 1) upload to Storage
      const { error: upErr } = await supabase.storage.from("thread-photos").upload(objName, file, {
        contentType: file.type || "image/jpeg",
        upsert: false,
      });
      if (upErr) throw upErr;

      // 2) insert row (MUST include uploader_id to satisfy RLS)
      const { error: insErr } = await supabase.from("thread_photos").insert({
        request_id: requestId,
        uploader_id: user.id,
        uploader_role: "seller",
        storage_path: objName,
      });
      if (insErr) throw insErr;

      await refreshPhotos();
    } catch (e: any) {
      console.error(e);
      alert(e.message ?? "Failed to upload photo");
    } finally {
      setUploadingPhoto(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function deletePhoto(p: ThreadPhotoRow) {
    const ok = confirm("Delete this photo?");
    if (!ok) return;

    try {
      // delete DB row (RLS only allows own)
      const { error: dErr } = await supabase.from("thread_photos").delete().eq("id", p.id);
      if (dErr) throw dErr;

      // attempt to delete storage object too (requires storage.objects delete policy)
      await supabase.storage.from("thread-photos").remove([p.storage_path]);

      setPhotoUrls((prev) => {
        const next = { ...prev };
        delete next[p.id];
        return next;
      });
      await refreshPhotos();
    } catch (e: any) {
      alert(e.message ?? "Failed to delete");
    }
  }

  const headerTitle = useMemo(() => {
    if (!req) return "Thread";
    return `${req.category} • ${req.public_area}`;
  }, [req]);

  const canSeeExact = !!(req?.locked_to_me && req?.lat != null && req?.lng != null);
  const canFulfill = !!(order?.id && order.status === "locked" && req?.locked_to_me);
  const remainingPhotos = Math.max(0, 3 - photos.length);

  return (
    <div className="mx-auto max-w-md px-4 py-5">
      <div className="mb-3 flex items-center justify-between">
        <button className="text-xs text-zinc-600" onClick={() => nav("/seller")}>
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

      <div className="mb-4 rounded-full border border-zinc-200 bg-zinc-50 p-1 flex">
        <button
          onClick={() => setTab("details")}
          className={[
            "flex-1 rounded-full px-3 py-2 text-xs font-medium transition",
            tab === "details" ? "bg-white shadow-sm border border-zinc-200 text-zinc-900" : "text-zinc-600",
          ].join(" ")}
        >
          Order
        </button>
        <button
          onClick={() => setTab("chat")}
          className={[
            "flex-1 rounded-full px-3 py-2 text-xs font-medium transition",
            tab === "chat" ? "bg-white shadow-sm border border-zinc-200 text-zinc-900" : "text-zinc-600",
          ].join(" ")}
        >
          Chat
        </button>
      </div>

      {!req ? (
        <div className="rounded-3xl border border-zinc-200 bg-white p-4">
          <div className="text-sm font-medium text-zinc-900">Not available yet</div>
          <div className="mt-1 text-xs text-zinc-600">This thread appears after you respond from Feed.</div>
          <button
            className="mt-3 inline-flex rounded-full bg-black text-white px-4 py-2 text-xs"
            onClick={() => nav("/seller/feed")}
          >
            Go to Feed
          </button>
        </div>
      ) : tab === "details" ? (
        <div className="space-y-3">
          <div className="rounded-3xl border border-zinc-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-zinc-500">
                  {req.city} • {req.public_area}
                </div>
                <div className="mt-2 text-[15px] leading-snug text-zinc-900">{req.text}</div>
                <div className="mt-2 text-[11px] text-zinc-500">
                  {req.mode === "later" && req.scheduled_at
                    ? `Later • ${new Date(req.scheduled_at).toLocaleString()}`
                    : req.mode === "takeaway"
                    ? "Takeaway"
                    : "Now"}
                </div>
              </div>

              <span
                className={[
                  "shrink-0 px-2 py-0.5 rounded-full text-[11px] border",
                  req.status === "open"
                    ? "border-zinc-200 text-zinc-700"
                    : req.status === "locked"
                    ? "border-amber-200 text-amber-700 bg-amber-50"
                    : req.status === "fulfilled"
                    ? "border-emerald-200 text-emerald-700 bg-emerald-50"
                    : "border-zinc-200 text-zinc-500 bg-zinc-50",
                ].join(" ")}
              >
                {req.status}
              </span>
            </div>

            {canSeeExact ? (
              <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs text-zinc-500">Exact delivery location (unlocked)</div>
                    <div className="mt-1 text-sm text-zinc-900">
                      {req.lat!.toFixed(5)}, {req.lng!.toFixed(5)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={openMaps}
                    className="shrink-0 rounded-full bg-black text-white px-3 py-2 text-xs"
                  >
                    Open in Maps
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-4 text-[11px] text-zinc-500">
                Exact location stays hidden until the buyer accepts your offer.
              </div>
            )}
          </div>

          {/* Photos */}
          <div className="rounded-3xl border border-zinc-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-zinc-900">Photos</div>
                <div className="mt-0.5 text-[11px] text-zinc-500">
                  Up to 3 photos per thread (buyer + seller combined).
                </div>
              </div>

              <button
                type="button"
                onClick={choosePhoto}
                disabled={uploadingPhoto || remainingPhotos === 0}
                className="shrink-0 rounded-full bg-black text-white px-4 py-2 text-xs disabled:opacity-60"
              >
                {uploadingPhoto ? "Uploading…" : "Add photo"}
              </button>

              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadPhoto(f);
                }}
              />
            </div>

            <div className="mt-3">
              {photos.length === 0 ? (
                <div className="text-xs text-zinc-500">No photos yet.</div>
              ) : (
                <div className="flex gap-3 flex-wrap">
                  {photos.map((p) => {
                    const url = photoUrls[p.id];
                    const mine = !!meId && p.uploader_id === meId;
                    return (
                      <div key={p.id} className="w-[92px]">
                        <div className="relative w-[92px] h-[92px] rounded-2xl border border-zinc-200 overflow-hidden bg-zinc-50">
                          {url ? (
                            <a href={url} target="_blank" rel="noreferrer">
                              <img src={url} alt="Thread photo" className="w-full h-full object-cover" />
                            </a>
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-[10px] text-zinc-500">
                              Loading…
                            </div>
                          )}

                          {mine ? (
                            <button
                              type="button"
                              onClick={() => deletePhoto(p)}
                              className="absolute top-1 right-1 rounded-full bg-black/80 text-white text-[10px] px-2 py-1"
                              title="Delete"
                            >
                              Delete
                            </button>
                          ) : null}
                        </div>

                        <div className="mt-1 inline-flex items-center gap-2">
                          <span className="text-[11px] text-zinc-500">
                            {p.uploader_role === "seller" ? "seller" : "buyer"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-3 text-xs text-zinc-500">Remaining: {remainingPhotos}</div>
            </div>
          </div>

          <div className="rounded-3xl border border-zinc-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-zinc-900">My offer</div>
              {myOffer?.status ? <span className="text-[11px] text-zinc-500">Status: {myOffer.status}</span> : null}
            </div>

            <div className="mt-3">
              {!myOffer ? (
                <div className="text-xs text-zinc-500">No offer found. Go to Feed and respond.</div>
              ) : (
                <div className="rounded-2xl border border-zinc-200 bg-white p-3">
                  <div className="text-xs text-zinc-500">
                    {myOffer.fulfillment} • {myOffer.eta_minutes ? `${myOffer.eta_minutes} min` : "ETA?"}
                  </div>
                  <div className="mt-2 text-sm text-zinc-900 whitespace-pre-wrap">{myOffer.message}</div>
                  <div className="mt-2 text-xs text-zinc-600">
                    {myOffer.price_total != null ? `₹${myOffer.price_total}` : "₹?"}
                    {myOffer.delivery_fee != null ? ` • Delivery ₹${myOffer.delivery_fee}` : ""}
                  </div>
                </div>
              )}
            </div>
          </div>

          {order?.id ? (
            <div className="rounded-3xl border border-zinc-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-zinc-900">Order</div>
                <div className="text-xs text-zinc-600">Status: {order.status}</div>
              </div>

              {canFulfill ? (
                <div className="mt-3 rounded-2xl border border-zinc-200 bg-white p-3">
                  <div className="text-xs text-zinc-500">Enter delivery PIN to fulfill</div>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      value={pin}
                      onChange={(e) => {
                        setPin(e.target.value);
                        setPinOk(null);
                      }}
                      className="flex-1 border border-zinc-200 rounded-xl px-3 py-2 text-sm outline-none"
                      placeholder="4-digit PIN"
                      inputMode="numeric"
                    />
                    <button
                      type="button"
                      onClick={fulfillWithPin}
                      disabled={fulfilling || pin.trim().length < 4}
                      className="rounded-xl bg-black text-white px-4 py-2 text-sm disabled:opacity-60"
                    >
                      {fulfilling ? "…" : "Fulfill"}
                    </button>
                  </div>

                  {pinOk !== null ? (
                    <div className="mt-2 text-xs">
                      {pinOk ? <span className="text-emerald-700">Fulfilled.</span> : <span className="text-red-600">Wrong PIN.</span>}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <SellerChatPanel msgs={msgs} draft={draft} onDraft={setDraft} onSend={sendMessage} sending={sending} />
      )}
    </div>
  );
}

function SellerChatPanel({
  msgs,
  draft,
  onDraft,
  onSend,
  sending,
}: {
  msgs: MsgRow[];
  draft: string;
  onDraft: (v: string) => void;
  onSend: () => void;
  sending: boolean;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [msgs.length]);

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
      <div className="px-4 py-3 border-b border-zinc-200 bg-white">
        <div className="text-sm font-medium text-zinc-900">Chat</div>
        <div className="mt-0.5 text-[11px] text-zinc-500">Confirm price, ETA, and delivery vs pickup.</div>
      </div>

      <div ref={listRef} className="px-3 py-3 h-[52vh] overflow-y-auto bg-zinc-50">
        {msgs.length === 0 ? (
          <div className="px-2 py-10 text-center text-xs text-zinc-500">No messages yet.</div>
        ) : (
          <div className="space-y-2">
            {msgs.map((m, idx) => {
              const mine = m.from_role === "seller";
              return (
                <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[86%] ${mine ? "items-end" : "items-start"} flex flex-col`}>
                    <div className="rounded-2xl px-3 py-2 text-[14px] leading-snug border border-zinc-200 bg-white shadow-[0_1px_0_rgba(0,0,0,0.02)]">
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

      <div className="border-t border-zinc-200 bg-white p-3">
        <div className="flex items-center gap-2">
          <input
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            placeholder="Message…"
            className="flex-1 border border-zinc-200 rounded-full px-4 py-3 text-sm outline-none bg-white"
            disabled={sending}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSend();
            }}
          />
          <button
            onClick={onSend}
            disabled={sending || !draft.trim()}
            className="rounded-full bg-black text-white px-4 py-3 text-sm disabled:opacity-60"
          >
            {sending ? "…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
