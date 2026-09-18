# Dashboard deploys

The full runbook — every secret and variable, the state of the box, the exact
`authorized_keys` line, how to trigger a manual deploy and how to roll back —
lives in the backend repo, because the server-side wrapper it documents serves
both repos:

**`Restaurant_Backend/deploy/vps/README.md`**
and **`Restaurant_Backend/deploy/vps/WRAPPER_CONTRACT.md`**

Start there. It also carries the warning that the previously-exposed production
Supabase repository secrets are **still unrotated**, and must be rotated *before*
either deploy workflow's push trigger is enabled.

This file covers only what is specific to this repo.

---

## The transport is git. The box builds this repo itself.

The registry design is gone — no GHCR, no `:prod` tag, no `pull_policy: always`,
no digests. `/opt/restaurant-dash/Restaurant_Dashboard_UI` is a real git clone of
this repo, fetched with a **read-only** deploy key, and
`/opt/restaurant-dash/docker-compose.yml` builds it as a **local build context**.

A deploy is therefore: the box fetches `main` and runs `next build`.

**That means `next build` runs on the production VPS**, on 2 vCPUs, next to live
POS traffic — and this repo's builder stage installs
`build-essential`/`g++`/`libvips-dev` on the way. It is the heaviest of the three
services to build. Deploy outside service hours; the deploy job allows 60
minutes.

## The pipeline here

`.github/workflows/deploy.yml`, `workflow_dispatch`-only for now:

1. **ci** — invokes `dashboard-ci.yml` unchanged via `workflow_call` (toolchain
   parity with the Dockerfile, lint, typecheck, `next build`, jest; Node 22). A
   red CI makes the deploy job **unreachable**.
2. **preflight** — the two static assertions below, on repository content. Last
   chance to catch either before a build starts on the production box.
3. **deploy** (`environment: production`, no third-party actions) — reads
   `revision` and `status` as a baseline → **refuses unless the backend service
   is already healthy** → `rd-deploy update dashboard` → proves the deploy → polls
   until healthy → probes `https://experiosolutions.dialdost.com/login`.

`update`, never `deploy`: `rd-deploy deploy` does not rebuild, so against a
local-context compose file it would converge on the same image and the pipeline
would go green having shipped nothing.

**The run must prove it shipped**, with two independent signals: the box's
`revision` must equal `github.sha`, *and* the container's uptime must show it was
recreated. If either fails the run exits 72 and does **not** roll back — rolling
back an image that was never replaced moves production backwards. Full reasoning
in the backend runbook.

There is **no migration gate** here, deliberately: this repo ships no SQL. The
wrapper still gates *every* `update`, so a `65` from here means a **backend**
migration is pending; the workflow says so explicitly and points at the backend
runbook.

### Rollback reverts the image, not the commit

`rd-deploy rollback dashboard` retags `:previous` back to `:latest` and
force-recreates, so it does revert the running code. But **the git working tree
on the box stays at the new commit**: the next `update dashboard` rebuilds the
bad commit and ships it again. After a rollback, revert on `main`.

On the very first `update dashboard` there is no `:previous` at all — the wrapper
warns and force-recreates the same image, which is a restart, not a rollback. The
workflow reports that as exit 74 rather than claiming a revert happened.

---

## Two invariants the workflow asserts, and one the Dockerfile asserts

All are silent when broken, which is why they are checked rather than trusted.

### `ARG BACKEND_INTERNAL_URL` in the `Dockerfile` — asserted by **preflight**

`next.config.ts` uses `BACKEND_INTERNAL_URL` as the destination of the
`/backend-api/:path*` rewrite, and `output: 'standalone'` **serialises that
rewrite into the build manifest**. It is a build-time value despite not being
`NEXT_PUBLIC_*`; runtime env does not reach it.

Without the ARG, the image bakes `localhost:3001` and every guest page —
`/order`, `/queue`, `/reserve`, `/cfd`, `/feedback` — breaks in production,
because a guest's phone cannot resolve the server's localhost.

The ARG carries the default `http://localhost:3001` on purpose. `ENV X=$ARG` with
an unset, default-less ARG yields an **empty string**, and `next.config.ts` reads
it with `?? 'http://localhost:3001'`, which does not fire on `""` — the rewrite
destination would collapse to `/:path*` and proxy to itself. Repeating the
default keeps a plain local `docker build` behaving as it does today.

**The production value now comes from the compose file on the box** (see below),
not from CI.

### `public/downloads` in `.dockerignore` — asserted by **preflight**

The ~94 MB APK and ~16 MB zip are git-tracked, but in production they are
**bind-mounted read-only** from `/opt/restaurant-dash/public/downloads` and are
deliberately not baked into the image. Without the ignore entry, the build
context handed to the daemon grows by ~110 MB on every deploy — now on the
production box itself — only for the mount to shadow it.

A deploy never writes to that directory, and the wrapper cannot be asked to.

**Consequence for local builds:** an image built without that bind mount serves
404 for `/downloads/*`. That is expected.

### `NEXT_PUBLIC_BACKEND_URL` is non-empty — asserted in the `Dockerfile` itself

This one is asserted in the image build, not in CI, because the outage it caused
came from a build that never went through CI — and because, with the box
building, CI can no longer see the value at all.

`ARG NEXT_PUBLIC_BACKEND_URL` originally had no default, so `ENV X=$ARG` on a
plain `docker build` produced an **empty string**. Every call site read it with
`?? 'http://localhost:3001'`, which does not fire on `""`, so the empty value was
baked into the browser bundle and every client base URL became `""`. The
dashboard then called its own origin: `POST /platform/auth/login` returned Next's
404 HTML, `JSON.parse` reported `Unexpected token '<', "<!DOCTYPE "...`, every
counter read 0, and guest pages reached by table QR codes broke on the same host.

The `ARG` now carries the `http://localhost:3001` default, and a `RUN` guard
before `npm run build` **fails the image build** if the value is blank. Because
the production build now runs on the box, that guard is the only thing standing
between a bad compose edit and a repeat of that outage — **do not remove it.**

Client code no longer reads the variable directly: `src/lib/backend-url.ts` is
the only reader, and it treats blank as unconfigured, falling back to the
same-origin `/backend-api` proxy in the browser.

> The old CI-side check that rejected a *localhost* value for production has been
> **deleted**, not disabled. CI no longer performs the build and cannot see the
> build args, so that check could never fail — and a check that cannot fail is
> worse than no check, because it is read as coverage.

---

## The image is environment-specific, and its build args live on the box

`NEXT_PUBLIC_*` values and the `/backend-api` rewrite are baked into the
standalone build, so this image **cannot be promoted to another environment
unchanged**. A staging environment needs its own build with its own variables.

Since the build happens on the VPS, those values come from the `build: args:`
block in `/opt/restaurant-dash/docker-compose.yml`, **which is not in git and
which no workflow can read or set**:

| Build arg | Production value |
|---|---|
| `NEXT_PUBLIC_BACKEND_URL` | the public origin guests reach — `https://api.dialdost.com` |
| `BACKEND_INTERNAL_URL` | `http://backend:3001` (the compose service name) |
| `NEXT_PUBLIC_FEEDBACK_FORM_URL` | unset unless the feedback form is hosted off-origin |

**If a guest page breaks after a deploy, look there first.** The repository
variables `vars.NEXT_PUBLIC_BACKEND_URL`, `vars.NEXT_PUBLIC_FEEDBACK_FORM_URL`
and `vars.BACKEND_INTERNAL_URL` are now **inert** — no workflow reads them. Leave
them or delete them; they do nothing.

### What this repo's workflow does read

| Name | Notes |
|---|---|
| `secrets.DEPLOY_SSH_KEY` | **environment** secret on `production` |
| `vars.DEPLOY_HOST` / `DEPLOY_USER` / `DEPLOY_PORT` | shared with the backend repo |
| `vars.SSH_KNOWN_HOSTS` | the deploy job **refuses to run** without it |
| `vars.PUBLIC_DASHBOARD_URL` | optional. Defaults to `https://experiosolutions.dialdost.com/login` in the workflow. If it never answers, the run is **red (exit 73)** but is **not** rolled back — the container is healthy on the box and an image swap cannot fix ingress |

---

## Ordering against the backend

GitHub `concurrency:` groups are **per-repository**. They cannot serialise a
dashboard deploy against a backend deploy, and there is no `flock` in the server
wrapper. Nothing serialises the two repos.

What exists: this workflow refuses to deploy unless the `backend` service is
already healthy (exit 69). That catches a backend that is down or mid-swap. It
does not catch a backend that is healthy now and swaps a second later.

Two things now make an interleave worse than it used to be: both deploys run a
**build** on the same 2-vCPU box, so they compete for CPU and memory and an
out-of-memory kill is realistic; and there is still no combined rollback.

**Ship API contract changes expand/contract:** add the field in the backend and
release it, then consume it here and release. Two deploys, decided by a person
who understands the contract. Do not push both repos at once.

Full discussion, including the optional server-side `flock`, is in
`Restaurant_Backend/deploy/vps/README.md`, *Cross-repo ordering*.

---

## Build reproducibility (resolved)

An earlier draft of this file flagged that `.dockerignore` excluded
`package-lock.json`, so the image resolved dependencies fresh with
`npm install --legacy-peer-deps`. **That is fixed.** The lockfile ships in the
build context, the `Dockerfile` `COPY`s it without a trailing glob (so a
re-ignored lockfile fails the build loudly instead of silently going unpinned),
and the image installs with `npm ci --legacy-peer-deps`. CI and the image build
on Node 22, and `dashboard-ci.yml` fails if those two ever drift.

This matters more under the git transport than it did under the registry one: the
tree CI tested and the tree the box builds are now the same commit, but they are
built **twice**, on different machines. A lockfile is what makes those two builds
the same software.
