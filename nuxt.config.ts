import tailwindcss from "@tailwindcss/vite";
import { alphaTab as alphaTabVite } from "@coderline/alphatab-vite";

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  ssr: false,
  devtools: { enabled: true },
  css: ["~/assets/css/main.css"],
  modules: ["nuxt-electron"],
  devServer: { port: 4399 },
  electron: {
    disableDefaultOptions: true,
    build: [
      { entry: "electron/main.ts" },
      { entry: "electron/preload.ts", onstart: (args) => args.reload() },
    ],
  },
  app: {
    baseURL: "/",
    head: {
      title: "Tabbycat",
      link: [{ rel: "icon", type: "image/svg+xml", href: "/icon.svg" }],
    },
  },
  nitro: {},
  vite: {
    plugins: [
      tailwindcss() as any,
      ...(alphaTabVite({ assetOutputDir: false }) as any),
    ],
  },
});
