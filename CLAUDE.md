# Tomo（伴）— guide for contributors and coding agents

Tomo is a desktop companion for international students in Japan (Windows and macOS; Japanese, Chinese, English).
It is an Electron + React app on top of [Hermes Agent](https://github.com/NousResearch/hermes-agent), which Tomo
uses **unmodified** at a pinned commit. School knowledge comes from packs in
[tomo-packs](https://github.com/tkyu-labs/tomo-packs); Tomo itself knows no school. `README.md` explains the product,
`BUILDING.md` the builds and releases. `AGENTS.md` points here.

## Who Tomo is for

Many users are not IT people; some got their first computer at university. Design every feature for them:

- **Ask as rarely as possible.** No confirmation dialogs for safe actions. Pages and files on the school's official
  site are trusted. A question is for personal data being sent to a model (one clear choice), or an unfamiliar
  third-party download (once). Never add a prompt "for safety" when the safe path can be made automatic.
- Plain words in the UI, no jargon; errors say what the student can do next.
- Every user-facing string exists in English, Simplified Chinese and Japanese (`useCopy()`:
  `c('English', '中文', '日本語')`). Japanese text never in a Chinese font.

## Architecture (what not to break)

```
renderer (React)  ⇄  preload (window.tomo, typed IPC)  ⇄  main (Node)  ⇄  stdio JSON-RPC  ⇄  Hermes tui_gateway
```

- **No listening ports.** The engine is a child process driven over stdio; never add an HTTP server.
- **Hermes stays unmodified.** Tomo changes its behaviour only through `config.yaml` (`src/main/setup/config.ts`),
  `SOUL.md`, environment variables and its two Hermes plugins in `plugins/` (`tomo-privacy`, `tomo`). If something
  seems to need a Hermes patch, find the config switch, plugin hook or RPC first; read the pinned source to confirm.
  The pin lives in `scripts/hermes-pin.env` and `src/main/engine/pin.ts` (kept equal by a test).
- **Everything stays in Tomo's data folder.** Hermes, its tools, caches and the browser profile run with
  `HERMES_HOME` and friends set by `src/main/hermes/env.ts`; nothing may touch `~/.hermes` or other user dotfiles.
  Only pass-through variables reach the engine; never inherit the whole environment.
- **Windows children die with Tomo**: the engine starts through `engine-helpers/tomo_gateway.py` (Job Object).
  Keep that launcher; `test/e2e/quit.mjs` checks that nothing outlives Tomo.
- One protocol adapter: `src/main/hermes/` (`contract.generated.ts` is generated from the pinned gateway).
- `src/main/app/controller.ts` holds the app logic without Electron, so it runs in integration tests;
  `src/main/index.ts` only wires it to IPC, windows and the tray.

## Privacy rules (product requirements, not preferences)

- **Identifiers never reach the engine.** Name and student number are replaced by `{{PLACEHOLDERS}}` before
  `prompt.submit` (Hermes stores raw prompts and auxiliary calls bypass request hooks) and in every event coming
  back (`HermesClient`, `Masker`). Only the renderer turns placeholders back into values, for display.
- Values are filled into tools only by the `tomo-privacy` plugin (`tool_execution` middleware), only on origins the
  pack allows. Personal-data sites (`personal_origins` in a pack) show the model page structure only; values read
  there reach the model after the student approves them.
- **Keys** live in the OS-encrypted store (`src/main/secrets/store.ts`, Keychain / DPAPI) and reach Hermes as
  process environment variables only. Never write a key to `HERMES_HOME/.env` or any file; never log one.
- **No portal passwords**, ever: the student signs in in Tomo's visible browser window.
- Tests, fixtures and docs use fictional data only (student "Lin Mei", `23B0001`). Never commit real student data,
  screenshots of real portals, or anything copied from a real account.

## Packs and compatibility

- Tomo reads a pack's `pack.yaml`, `hatch.yaml`, `soul.md` and skills; it enforces the permissions declared there.
- Packs must keep working on older Tomo versions. When Tomo gains something packs can use (an environment variable,
  a tool), give packs a fallback path; restrict with `requires.tomo` (a Tomo version, never a commit) only when a
  feature is impossible without it.
- Optional engine extras (e.g. `ddgs` for DuckDuckGo search) are listed in `ENGINE_EXTRAS`
  (`src/main/engine/installer.ts`); an existing install is re-synced when the list changes.

## Working on the code

```sh
scripts/dev-hermes.sh            # pinned Hermes + Python in .dev/ (once, and after a pin change)
source scripts/dev-env.sh        # project-local caches and HERMES_HOME
npm install                      # npm 12+: then run `node node_modules/electron/install.js`
npm run dev
npm run typecheck && npm run lint && npm test && npm run test:py
npm run test:e2e                 # builds, then drives the real app (smoke, window, dialogs, first run)
```

- TypeScript strict, ESLint clean, no `any` without a reason. Small modules with one job; comments say *why*.
- Code, identifiers, comments, commit messages and docs in English.
- Tests: unit tests next to the code (`*.test.ts`), integration tests in `test/integration/` against a real
  pinned Hermes with the stub model (`test/stub-model/server.mjs`, no network, no cost), e2e in `test/e2e/` over the
  Chrome DevTools Protocol. Check UI through the DOM (`data-testid`), not screenshots. Tests that need network or a
  real model are opt-in (`test/real/`, environment flags) and never run in CI by default.
- New UI follows the existing design language (system fonts, calm controls, Font Awesome Free solid icons via
  `src/renderer/src/ui/Icon.tsx`); keep `data-testid` on anything a test reads.
- Windows and macOS both matter: paths via `node:path`, no shell-specific commands in the app, test on both when
  you touch processes, the browser, the tray or files.

## Version numbers

Tomo, every pack (`pack.yaml` → `version`) and every skill (`SKILL.md` → `version`) use **MAJOR.MINOR.PATCH**, each
counted on its own:

- **MAJOR** is raised only by a maintainer. A coding agent never raises it.
- **MINOR** goes up when a feature is added or removed (then PATCH starts again at 0).
- **PATCH** goes up for fixes and improvements of existing features.
- **No carry-over**: the numbers are not decimals. After `0.1.9` comes `0.1.10`, then `0.1.11`, …; only a new or
  removed feature makes it `0.2.0`. If you cannot tell whether a change is a feature or a fix, ask the maintainer.
- Compare with the last released version: several changes before one release get one bump (the largest kind among
  them).

## Commits and pull requests

- Conventional Commits: `feat: …`, `fix: …`, `docs: …`, `test: …`, `ci: …`, `chore: …`; one commit per finished,
  coherent change. Describe the user-visible effect.
- Before a PR: typecheck, lint, unit + integration tests, and the e2e tests if you touched the UI or main process.
- Never commit secrets, `.dev/`, `release/`, build output, local agent notes or data from a real account.
