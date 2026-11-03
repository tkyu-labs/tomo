interface ImportMetaEnv {
  /** GakuenAI relay URL for tester builds, injected by electron-vite at build time (never committed). */
  readonly MAIN_VITE_GAKUEN_URL?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
