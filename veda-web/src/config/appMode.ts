// src/config/appMode.ts
export type AppMode = "buyer" | "seller";

function readRuntimeMode(): AppMode | null {
  // 1) meta tag override (best for Android flavored index.html)
  const meta = document.querySelector('meta[name="veda-mode"]') as HTMLMetaElement | null;
  const v1 = (meta?.content || "").trim();
  if (v1 === "buyer" || v1 === "seller") return v1;

  // 2) window override (optional)
  const v2 = (window as any).__VEDA_MODE__;
  if (v2 === "buyer" || v2 === "seller") return v2;

  return null;
}

export const APP_MODE: AppMode =
  readRuntimeMode() ||
  ((import.meta.env.VITE_APP_MODE as AppMode) || "buyer");

export const IS_BUYER = APP_MODE === "buyer";
export const IS_SELLER = APP_MODE === "seller";
