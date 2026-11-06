import { join } from 'node:path'

// Variables the gateway inherits from Tomo's own environment. Everything else (including any API keys the user
// happens to have exported in their shell) is dropped: Hermes reads `.env`-style variables from the process, so
// inheriting the whole environment would silently change which provider and key it uses.
const PASS_THROUGH = [
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TZ',
  // Windows
  'SystemRoot', 'SYSTEMROOT', 'windir', 'WINDIR', 'COMSPEC', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE',
  'LOCALAPPDATA', 'APPDATA', 'HOMEDRIVE', 'HOMEPATH', 'USERNAME', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramData',
  'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS',
]

export interface HermesEnvInput {
  base: Record<string, string | undefined>
  hermesHome: string
  /** Hermes' tool runtime (agent-browser, Python, uv) — default `<hermesHome>/tools`; the app may point it at a shared copy. */
  runtimeDir?: string
  /** Folder for npm / uv / node caches that Hermes' tools may create. */
  cacheDir: string
  /** API keys by variable name (OPENAI_API_KEY, GAKUEN_API_KEY, …). Never written to disk. */
  keys?: Record<string, string>
  /** Serialized identifier values for the privacy plugin, which reads and removes it on load. */
  privatePayload?: string
  browser?: { executablePath?: string; profileDir?: string }
  /** Folders pack skills use from the terminal: downloads (Tomo's scratch folder) and documents the student kept. */
  folders?: { downloads?: string; documents?: string }
}

/** The complete environment for the gateway process. */
export function buildHermesEnv(input: HermesEnvInput): Record<string, string> {
  const env: Record<string, string> = {}
  for (const name of PASS_THROUGH) {
    const value = input.base[name]
    if (value !== undefined) env[name] = value
  }
  Object.assign(env, {
    HERMES_HOME: input.hermesHome,
    HERMES_RUNTIME_DIR: input.runtimeDir ?? join(input.hermesHome, 'tools'),
    HERMES_GATEWAY_LOCK_DIR: join(input.hermesHome, 'locks'),
    npm_config_cache: join(input.cacheDir, 'npm'),
    UV_CACHE_DIR: join(input.cacheDir, 'uv'),
    UV_PYTHON_INSTALL_DIR: join(input.cacheDir, 'python'),
    NODE_COMPILE_CACHE: join(input.cacheDir, 'node-compile'),
    // Tools Hermes probes (gh for Copilot detection, git, npm, …) follow XDG / GH_CONFIG_DIR: keep their state in
    // Tomo's folder and hide the user's own GitHub CLI login from the agent (hermes_cli/copilot_auth.py:80-120).
    GH_CONFIG_DIR: join(input.hermesHome, 'xdg', 'gh'),
    XDG_CONFIG_HOME: join(input.hermesHome, 'xdg', 'config'),
    XDG_STATE_HOME: join(input.hermesHome, 'xdg', 'state'),
    XDG_CACHE_HOME: join(input.cacheDir, 'xdg'),
    XDG_DATA_HOME: join(input.hermesHome, 'xdg', 'data'),
    // bytecode caches of every Python the engine starts (incl. the system one) stay in Tomo's folder
    PYTHONPYCACHEPREFIX: join(input.cacheDir, 'pycache'),
    PYTHONUNBUFFERED: '1',
    PYTHONIOENCODING: 'utf-8',
  })
  if (input.browser?.executablePath) env.AGENT_BROWSER_EXECUTABLE_PATH = input.browser.executablePath
  if (input.browser?.profileDir) env.AGENT_BROWSER_PROFILE = input.browser.profileDir
  for (const [name, value] of Object.entries(input.keys ?? {})) {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) throw new Error(`invalid key variable name: ${name}`)
    env[name] = value
  }
  if (input.folders?.downloads) env.TOMO_DOWNLOADS = input.folders.downloads
  if (input.folders?.documents) env.TOMO_DOCUMENTS = input.folders.documents
  if (input.privatePayload !== undefined) env.TOMO_PRIVATE = input.privatePayload
  return env
}
