import { useEffect, useState } from "react";

export default function OfferSheet({
  open,
  onClose,
  onSubmit,
  requestText,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    message: string;
    price_total: number | null;
    delivery_fee: number | null;
    fulfillment: "delivery" | "pickup";
    eta_minutes: number | null;
  }) => Promise<void>;
  requestText: string;
}) {
  const [message, setMessage] = useState("");
  const [price, setPrice] = useState<string>("");
  const [deliveryFee, setDeliveryFee] = useState<string>("");
  const [eta, setEta] = useState<string>("");
  const [fulfillment, setFulfillment] = useState<"delivery" | "pickup">("delivery");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setMessage("");
      setPrice("");
      setDeliveryFee("");
      setEta("");
      setFulfillment("delivery");
      setBusy(false);
    }
  }, [open]);

  if (!open) return null;

  async function submit() {
    const msg = message.trim();
    if (!msg) return;

    setBusy(true);
    try {
      await onSubmit({
        message: msg,
        price_total: price ? Number(price) : null,
        delivery_fee: deliveryFee ? Number(deliveryFee) : null,
        fulfillment,
        eta_minutes: eta ? Number(eta) : null,
      });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-t-3xl bg-white border border-zinc-200 shadow-2xl">
        {/* Handle */}
        <div className="pt-3 flex justify-center">
          <div className="h-1.5 w-12 rounded-full bg-zinc-200" />
        </div>

        <div className="px-4 pt-3 pb-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-zinc-900">Send offer</div>
              <div className="mt-0.5 text-[11px] text-zinc-500">
                Keep it clear: price, delivery fee, ETA.
              </div>
            </div>
            <button className="text-xs text-zinc-600" onClick={onClose}>
              Close
            </button>
          </div>

          <div className="mt-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
            <div className="text-[11px] text-zinc-500">Request</div>
            <div className="mt-1 text-sm text-zinc-900">{requestText}</div>
          </div>

          <div className="mt-3">
            <div className="text-[11px] text-zinc-500 mb-1">Message</div>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              className="w-full border border-zinc-200 rounded-2xl px-3 py-3 text-sm outline-none"
              placeholder="Example: Can do it today. ₹75/pc. Delivery ₹30. ETA 40 mins."
            />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <Field label="Total price (optional)">
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full border border-zinc-200 rounded-2xl px-3 py-3 text-sm outline-none"
                placeholder="e.g. 2250"
                inputMode="numeric"
              />
            </Field>
            <Field label="Delivery fee (optional)">
              <input
                value={deliveryFee}
                onChange={(e) => setDeliveryFee(e.target.value)}
                className="w-full border border-zinc-200 rounded-2xl px-3 py-3 text-sm outline-none"
                placeholder="e.g. 30"
                inputMode="numeric"
              />
            </Field>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div>
              <div className="text-[11px] text-zinc-500 mb-1">Fulfillment</div>
              <div className="flex gap-2">
                <button
                  onClick={() => setFulfillment("delivery")}
                  type="button"
                  className={[
                    "flex-1 rounded-full px-3 py-2 text-xs border transition",
                    fulfillment === "delivery"
                      ? "bg-black text-white border-black"
                      : "bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50",
                  ].join(" ")}
                >
                  Delivery
                </button>
                <button
                  onClick={() => setFulfillment("pickup")}
                  type="button"
                  className={[
                    "flex-1 rounded-full px-3 py-2 text-xs border transition",
                    fulfillment === "pickup"
                      ? "bg-black text-white border-black"
                      : "bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50",
                  ].join(" ")}
                >
                  Pickup
                </button>
              </div>
            </div>

            <Field label="ETA minutes (optional)">
              <input
                value={eta}
                onChange={(e) => setEta(e.target.value)}
                className="w-full border border-zinc-200 rounded-2xl px-3 py-3 text-sm outline-none"
                placeholder="e.g. 40"
                inputMode="numeric"
              />
            </Field>
          </div>

          <button
            onClick={submit}
            disabled={busy || !message.trim()}
            className={[
              "mt-4 w-full rounded-2xl py-3 text-sm font-medium transition",
              busy || !message.trim() ? "bg-zinc-200 text-zinc-500" : "bg-black text-white hover:opacity-95",
            ].join(" ")}
          >
            {busy ? "Sending…" : "Send offer"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] text-zinc-500 mb-1">{label}</div>
      {children}
    </div>
  );
}
