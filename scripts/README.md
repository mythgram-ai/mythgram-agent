# Scripts

Utility scripts for the Mythgram monorepo. Every script is standalone (plain
Bash, no extra dependencies) and works from any working directory — they resolve
the repository root from their own location.

```bash
./scripts/setup.sh        # install dependencies + seed .env files
./scripts/dev.sh          # run backend + web console in dev mode
./scripts/full-test.sh    # init + typecheck + build + test (both packages)
./scripts/build.sh        # production build of the publishable package
./scripts/lint.sh         # lint the frontend packages (oxlint)
./scripts/clean.sh        # remove build output, caches, logs
```

| Script | What it does |
| --- | --- |
| `full-test.sh` | The full quality gate for **both** `packages/mythgram` and `packages/frontend-main`: installs deps, typechecks, builds, and runs tests. Exits non-zero if anything fails. |
| `setup.sh` | Bootstraps the repo: `npm install` for the root, backend, and frontend, then copies `.env.example` → `.env` where missing (never overwrites). |
| `dev.sh` | Starts the backend (`:8787`) and the Vite console (`:5173`) together, writes logs to `.logs/`, and waits for `/health`. Ctrl+C stops both. |
| `build.sh` | Typechecks and builds the backend, then builds the console into `packages/mythgram/dist/web` — the exact artifact `npm publish` ships. |
| `lint.sh` | Runs `oxlint` in `frontend-main` and `local-tts/web-ui`; skips packages that lack dependencies or a lint script. |
| `clean.sh` | Deletes `dist/`, `*.tsbuildinfo`, `.logs/`, and root `*.log`. Add `--all` to also drop every `node_modules`. |

## Common recipes

```bash
# First checkout: install everything and start developing
./scripts/setup.sh && ./scripts/dev.sh

# Reproducible CI-style verification with lockfile-exact installs
FULL_TEST_CI=1 ./scripts/full-test.sh

# Fast local loop: reuse existing node_modules, skip the build
FULL_TEST_SKIP_INIT=1 FULL_TEST_NO_BUILD=1 ./scripts/full-test.sh

# Full build, then inspect exactly what would be published
./scripts/build.sh --pack

# Nuke generated output (and node_modules) before a clean rebuild
./scripts/clean.sh --all && ./scripts/setup.sh
```

## Environment variables

| Variable | Used by | Effect |
| --- | --- | --- |
| `FULL_TEST_CI=1` | `full-test.sh` | Use `npm ci` (clean, lockfile-exact install). |
| `FULL_TEST_SKIP_INIT=1` | `full-test.sh` | Skip dependency installation. |
| `FULL_TEST_NO_BUILD=1` | `full-test.sh` | Skip the build step (typecheck + test only). |
| `SETUP_CI=1` | `setup.sh` | Use `npm ci`. |
| `SETUP_NO_ENV=1` | `setup.sh` | Do not create `.env` files. |
| `PORT`, `VITE_PORT` | `dev.sh` | Override the backend / frontend ports. |
| `MYTHGRAM_API_URL` | `dev.sh` | Backend target for the Vite proxy. |

## Notes

- The Git hook (`.husky/pre-commit`) runs the same typecheck/lint checks for the
  packages a commit touches; `full-test.sh` is the manual, whole-repo equivalent.
- `frontend-main` currently has no test script, so `full-test.sh` runs its test
  step with `--if-present` and reports it as green.
- The root `start.sh` / `stop.sh` remain available; `scripts/dev.sh` is a
  friendlier front door for the same backend + frontend development workflow.
