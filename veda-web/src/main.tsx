// /Users/partha/Desktop/veda/veda-web/src/main.tsx
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { supabase } from "./lib/supabase";

if (Capacitor.isNativePlatform()) {
  CapApp.addListener("appUrlOpen", async () => {
    // IMPORTANT: Supabase JS sees tokens in URL and finalizes session
    // detectSessionInUrl:true is already set in supabase.ts
    try {
      // This forces Supabase to re-check and persist session after deep link
      await supabase.auth.getSession();
    } catch (e) {
      console.error("appUrlOpen handling failed", e);
    }
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);
