# Building Tomo

Tomo does not ship the AI engine. On first start it downloads [Hermes Agent](https://github.com/NousResearch/hermes-agent)
at the commit pinned in `scripts/hermes-pin.env`, checks the archive's SHA-256, and installs it into Tomo's data folder
with the [uv](https://docs.astral.sh/uv/) that ships with the app (`scripts/uv-pin.json`, hash-checked when building;
`uv sync --frozen` checks every dependency against Hermes' `uv.lock`). An app update keeps the installed engine unless
the pin changes. Installers are therefore small and the same for every Hermes-unchanged release.

## Common steps

Requirements: Node.js 22+, [uv](https://docs.astral.sh/uv/), Git (on Windows: Git for Windows, whose Git Bash runs
the shell scripts).

```sh
scripts/dev-hermes.sh             # pinned Hermes + Python in .dev/
source scripts/dev-env.sh         # project-local caches (Git Bash on Windows)
npm install
npm test && npm run typecheck && npm run lint
```

npm 12 and later skip dependency install scripts by default, so Electron's binary is not downloaded. Run
`node node_modules/electron/install.js` once after `npm install` (or `npm ci`).

School packs are not part of the app. Tomo reads the list of packs from tomo-packs `main` during the first run,
downloads the chosen one and updates it from `main` later (`src/main/pack/remote.ts`: catalog `lock_sha256`, every
file checked against `pack.lock`). Development and tests use a local folder instead: `TOMO_PACKS_DIR` (default in
development: the nested `tomo-packs/packs` checkout, else `test/fixtures/packs`).

## Tester builds with GakuenAI

The GakuenAI option appears only when the build knows the relay URL. Set it when building (it is compiled into the
app, not committed): `MAIN_VITE_GAKUEN_URL=<relay>/v1 npm run dist:mac` (or `dist:win`). In development,
`TOMO_GAKUEN_URL` or `GAKUEN_API_GATEWAY` in the environment works too. GakuenAI uses the OpenAI Responses protocol.

## macOS

```sh
npm run dist:mac                  # → release/Tomo-<version>-arm64.dmg (unsigned)
test/e2e/install-dmg.sh           # installs into a temporary folder and walks first run to a first answer
```

Signed builds: set `mac.identity` to your Developer ID Application certificate, `mac.hardenedRuntime: true` and the
notarisation options of electron-builder on the release machine (not in this repository); sign with a secure
timestamp so the app keeps opening after the certificate expires, then notarise and staple.

## Windows

On a Windows 10/11 x64 PC, in Git Bash (uv can be a single `uv.exe` on PATH; `core.autocrlf` may stay on — the
shell scripts are checked out with LF through `.gitattributes`):

```sh
npm run dist:win                  # → release/Tomo-Setup-<version>.exe (unsigned, per-user install) + release/win-unpacked
TOMO_E2E_APP="$(cygpath -w "$PWD/release/win-unpacked/Tomo.exe")" TOMO_E2E_PACK=shonan-it node test/e2e/first-run.mjs
# nothing outlives Tomo: quit and hard kill with the browser and a background command running (needs network)
TOMO_E2E_APP="$(cygpath -w "$PWD/release/win-unpacked/Tomo.exe")" TOMO_E2E_PACK=shonan-it node test/e2e/quit.mjs
```

Then check on that PC:

1. The installer runs without administrator rights and Tomo starts.
2. First run reaches "Tomo is ready" (Microsoft Edge is found; the engine starts).
3. A question gets an answer; Settings → About shows the engine as ready.
4. The terminal tool works (Hermes needs Git Bash; if it reports "No shell found", install Git for Windows).

Unsigned installers show a SmartScreen warning; sign with your code-signing certificate on the release machine.

### Portable build

```sh
npm run dist:win:portable          # → release/Tomo-Portable-<version>.zip (after the installer build)
```

The zip holds `Tomo-Portable-<version>/Tomo.exe` (a small launcher, `build-resources/portable/launcher.cs`, compiled
with the C# compiler that ships with Windows), `App/` (the app with `portable.json`) and `Data/`. The app keeps all of
its data in `Data/` and protects the secret store with a password the student sets on first start (no DPAPI, since
the folder moves between computers). Portable builds do not update themselves: Tomo reports a newer release and the
student replaces `App/`. `node test/e2e/portable.mjs` checks the password flow (simulated with `TOMO_PORTABLE_ROOT`
on any OS).

### Uninstalling

The uninstaller asks once whether to delete the student's data in `%LOCALAPPDATA%\Tomo` (default: keep it); updates
and silent uninstalls (`/S`) never delete it (`build-resources/installer.nsh`).

## Releases and automatic updates

Pushing a version tag builds Tomo in GitHub Actions (`.github/workflows/release.yml`, macOS arm64 + Windows x64) and
uploads the installers and the update feeds (`latest-mac.yml`, `latest.yml`) to a **draft** release. Publishing the
draft ships the update: installed apps check at start and every 6 hours, download in the background and install when
Tomo quits (Settings → About shows the state and offers "Restart now"). macOS applies updates only to signed apps.

### Repository secrets (Settings → Secrets and variables → Actions)

| Secret | Value |
|---|---|
| `GAKUEN_URL` | GakuenAI relay URL ending in `/v1` (compiled into the app; useless without a key) |
| `MAC_CERT_P12_BASE64` | your *Developer ID Application* certificate **with its private key**, exported from Keychain Access as `.p12`, then `base64 -i cert.p12 \| pbcopy` |
| `MAC_CERT_PASSWORD` | the password you set when exporting the `.p12` |
| `APPLE_ID` | the Apple Account e-mail of the developer team |
| `APPLE_APP_SPECIFIC_PASSWORD` | an app-specific password from account.apple.com → Sign-In and Security |
| `APPLE_TEAM_ID` | your 10-character Team ID (developer.apple.com → Membership) |

Without the macOS secrets the workflow still builds, unsigned (no automatic updates on macOS). The certificate is
given to the macOS job only. Windows builds are always unsigned (SmartScreen warns once); updates work regardless.

### Making a release

```sh
npm version 0.1.1 --no-git-tag-version   # updates package.json
git commit -am "chore: release 0.1.1"
git tag v0.1.1 && git push && git push origin v0.1.1
```

Then open the draft release, check that it has the `.dmg`, `-mac.zip`, `latest-mac.yml`, `Tomo-Setup-<version>.exe`,
`latest.yml` and the `.blockmap` files, and press **Publish**. A new Hermes pin in the release is installed by the app's
engine step after the update.

### Checking an update locally

`node test/e2e/update-check.mjs <installed app binary> <folder with a newer build>` serves the folder as an update feed
(e.g. built with `-c.extraMetadata.version=<higher> -c.directories.output=.dev/release-next`) and reports the states; delete `.dev/release-next` afterwards.
