# Tomo（伴）

A desktop companion for international students in Japan. Tomo answers questions about courses, school rules and
procedures, helps with Japanese, and can operate the browser after the student approves each step. It runs on
Windows and macOS and speaks Japanese, Chinese and English.

Tomo is school-agnostic; a school **pack** from [tomo-packs](https://github.com/tkyu-labs/tomo-packs) adds one
school's knowledge, skills and first-run questions. The agent engine is [Hermes Agent](https://github.com/NousResearch/hermes-agent),
used unmodified at a pinned release (`scripts/hermes-pin.env`) and driven over stdio — Tomo opens no network port.

## Privacy

- Identifiers (name, student number) are replaced by `{{PLACEHOLDERS}}` before anything reaches the engine or a
  model, and shown as real values only on screen.
- Other personal data (grades, self-checks) is sent only after the student approves each item.
- API keys are kept in the operating system's encrypted storage and never written to the engine's files.
- Tomo never stores or types portal passwords; the student signs in in Tomo's own browser window.

## Development

Requirements: Node.js 22+, [uv](https://docs.astral.sh/uv/), Git.

```sh
scripts/dev-hermes.sh          # pinned Hermes in .dev/ (isolated from any ~/.hermes)
source scripts/dev-env.sh      # project-local caches and HERMES_HOME
npm install
npm run dev                    # start the app
npm test && npm run typecheck && npm run lint
```

Everything for development (Hermes checkout, Python environment, data, caches) lives in `.dev/`, which is not
committed.

## Licence

MIT (`LICENSE`).
