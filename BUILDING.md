# Building Tomo

Tomo ships its own copy of [Hermes Agent](https://github.com/NousResearch/hermes-agent) at the pinned release in
`scripts/hermes-pin.env`. Python environments cannot be moved, so the engine is built on the operating system and
architecture it is for: macOS builds on a Mac, Windows builds on a Windows PC.

## Common steps

Requirements: Node.js 22+, [uv](https://docs.astral.sh/uv/), Git (on Windows: Git for Windows, whose Git Bash runs
the shell scripts).

```sh
scripts/dev-hermes.sh             # pinned Hermes + Python in .dev/
source scripts/dev-env.sh         # project-local caches (Git Bash on Windows)
npm install
npm test && npm run typecheck && npm run lint
```

The packs that ship with the app come from `TOMO_PACKS_SRC` (a `packs` folder) or the local tomo-packs checkout.
For a release, use a signed pack release, verified before it is bundled:

```sh
node scripts/fetch-pack-release.mjs shonan-it 0.1.0   # checks the Sigstore bundle against the tomo-packs release workflow
export TOMO_PACKS_SRC=build/pack-releases/packs
```

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
npm run dist:win                  # → release/Tomo Setup <version>.exe (unsigned, per-user install) + release/win-unpacked
TOMO_E2E_APP="$(cygpath -w "$PWD/release/win-unpacked/Tomo.exe")" TOMO_E2E_PACK=shonan-it node test/e2e/first-run.mjs
```

Then check on that PC:

1. The installer runs without administrator rights and Tomo starts.
2. First run reaches "Tomo is ready" (Microsoft Edge is found; the engine starts).
3. A question gets an answer; Settings → About shows the engine as ready.
4. The terminal tool works (Hermes needs Git Bash; if it reports "No shell found", install Git for Windows).

Unsigned installers show a SmartScreen warning; sign with your code-signing certificate on the release machine.
