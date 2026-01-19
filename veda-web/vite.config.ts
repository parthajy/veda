import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // IMPORTANT for Capacitor file:// builds
  base: "./",
  build: {
    assetsDir: "assets",
  },
});
