// src/components/thread/ThreadPhotosPanel.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import { Plus } from "lucide-react";

type PhotoRow = {
  id: string;
  request_id: string;
  uploader_id: string;
  uploader_role: "buyer" | "seller" | string;
  storage_path: string;
  created_at: string;
};

export default function ThreadPhotosPanel({
  requestId,
  uploaderRole, // pass "buyer" on buyer page, "seller" on seller page
}: {
  requestId: string;
  uploaderRole: "buyer" | "seller";
}) {
  const [meId, setMeId] = useState<string | null>(null);
  const [rows, setRows] = useState<PhotoRow[]>([]);
  const [busy, setBusy] = useState(false);

  // signed URLs cache
  const [urls, setUrls] = useState<Record<string, string>>({});

  // fullscreen viewer
  const [view, setView] = useState<{ id: string; url: string } | null>(null);

  const fileRef = useRef<HTMLInputElement | null>(null);

  const remaining = useMemo(() => Math.max(0, 3 - (rows?.length ?? 0)), [rows?.length]);

  useEffect(() => {
    if (!requestId) return;
    (async () => {
      const user = (await supabase.auth.getUser()).data.user;
      setMeId(user?.id ?? null);
      await refresh();
    })().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId]);

  async function refresh() {
    const { data, error } = await supabase
      .from("thread_photos")
      .select("id, request_id, uploader_id, uploader_role, storage_path, created_at")
      .eq("request_id", requestId)
      .order("created_at", { ascending: true });

    if (error) throw error;

    const nextRows = (data ?? []) as any as PhotoRow[];
    setRows(nextRows);

    // sign URLs (keep existing where possible)
    const next: Record<string, string> = {};
    for (const r of nextRows) {
      if (urls[r.id]) {
        next[r.id] = urls[r.id];
        continue;
      }
      const { data: signed, error: signErr } = await supabase.storage
        .from("thread-photos")
        .createSignedUrl(r.storage_path, 60 * 60); // 1h

      if (!signErr && signed?.signedUrl) next[r.id] = signed.signedUrl;
    }
    if (Object.keys(next).length) setUrls((prev) => ({ ...prev, ...next }));
  }

  function chooseFiles() {
    if (busy) return;
    if (remaining <= 0) return;
    fileRef.current?.click();
  }

  async function onPickFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (remaining <= 0) return alert("Max 3 photos per thread.");

    const user = (await supabase.auth.getUser()).data.user;
    if (!user) return alert("Please login again.");

    const take = Array.from(files).slice(0, remaining);

    setBusy(true);
    try {
      for (const file of take) {
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
        const safeExt = ["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "jpg";

        // IMPORTANT: include user.id in path for ownership + future storage delete policies
        const path = `${requestId}/${user.id}/${crypto.randomUUID()}.${safeExt}`;

        const up = await supabase.storage.from("thread-photos").upload(path, file, {
          upsert: false,
          contentType: file.type || "image/jpeg",
        });
        if (up.error) throw up.error;

        // IMPORTANT: satisfy RLS (uploader_id must equal auth.uid())
        const ins = await supabase.from("thread_photos").insert({
          request_id: requestId,
          uploader_id: user.id,
          uploader_role: uploaderRole,
          storage_path: path,
        });
        if (ins.error) throw ins.error;
      }

      await refresh();
    } catch (e: any) {
      alert(e.message ?? "Failed to upload photo");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function open(row: PhotoRow) {
    // use cached signed url if present; otherwise sign now
    const cached = urls[row.id];
    if (cached) {
      setView({ id: row.id, url: cached });
      return;
    }
    const { data, error } = await supabase.storage.from("thread-photos").createSignedUrl(row.storage_path, 60 * 60);
    if (error) return alert(error.message);
    const signedUrl = data?.signedUrl ?? null;
    if (!signedUrl) return;
    setUrls((prev) => ({ ...prev, [row.id]: signedUrl }));
    setView({ id: row.id, url: signedUrl });
  }

  async function del(row: PhotoRow) {
    const ok = confirm("Delete this photo?");
    if (!ok) return;

    setBusy(true);
    try {
      // 1) delete DB row (this is what matters for UI + permissions)
      const { error } = await supabase.from("thread_photos").delete().eq("id", row.id);
      if (error) throw error;

      // 2) best-effort storage delete (may fail if you can't add storage.objects policy today)
      await supabase.storage.from("thread-photos").remove([row.storage_path]);

      setUrls((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      if (view?.id === row.id) setView(null);

      await refresh();
    } catch (e: any) {
      alert(e.message ?? "Failed to delete");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="rounded-3xl border border-zinc-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-zinc-900">Photos</div>
            <div className="text-[11px] text-zinc-500">Up to 3 photos per thread (buyer + seller combined).</div>
          </div>

          <button
  type="button"
  onClick={chooseFiles}
  disabled={busy || remaining <= 0}
  className={[
    "inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs transition",
    busy || remaining <= 0
      ? "bg-zinc-100 text-zinc-400 border-zinc-200"
      : "bg-black text-white border-black hover:opacity-95 active:scale-[0.99]",
  ].join(" ")}
>
  <Plus size={14} />
  {busy ? "Working…" : remaining <= 0 ? "Limit reached" : "Add photo"}
</button>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            disabled={busy || remaining <= 0}
            multiple
            onChange={(e) => onPickFiles(e.target.files)}
          />
        </div>

        {rows.length === 0 ? (
          <div className="mt-3 text-xs text-zinc-500">No photos yet.</div>
        ) : (
          <div className="mt-3 grid grid-cols-3 gap-2">
            {rows.map((r) => {
              const mine = !!meId && r.uploader_id === meId;
              const thumbUrl = urls[r.id] ?? null;

              return (
                <div key={r.id} className="relative">
                  <button
                    type="button"
                    onClick={() => open(r)}
                    className="aspect-square w-full rounded-2xl border border-zinc-200 bg-zinc-50 overflow-hidden"
                    title={`${r.uploader_role} • ${new Date(r.created_at).toLocaleString()}`}
                  >
                    {thumbUrl ? (
                      <img src={thumbUrl} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full" />
                    )}
                  </button>

                  {mine ? (
                    <button
                      type="button"
                      onClick={() => del(r)}
                      className="absolute top-1 right-1 rounded-full bg-black/80 text-white text-[10px] px-2 py-1"
                      title="Delete"
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-2 text-[11px] text-zinc-500">
          Remaining: <span className="text-zinc-700">{remaining}</span>
        </div>
      </div>

      {/* Fullscreen viewer */}
      {view ? (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center px-4 z-50"
          onClick={() => setView(null)}
        >
          <div className="max-w-md w-full rounded-3xl bg-white overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200">
              <div className="text-sm font-medium text-zinc-900">Photo</div>
              <button className="text-xs text-zinc-600" onClick={() => setView(null)}>
                Close
              </button>
            </div>
            <img src={view.url} className="w-full h-auto" />
          </div>
        </div>
      ) : null}
    </>
  );
}
