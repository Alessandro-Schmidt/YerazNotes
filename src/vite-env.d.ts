/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** '1' in end-to-end test builds (playwright.config.ts). */
  readonly VITE_E2E?: string
}

/** The app's version, from src-tauri/tauri.conf.json (vite.config.ts). */
declare const __YERAZ_VERSION__: string
