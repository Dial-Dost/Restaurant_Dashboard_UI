# Dashboard deploys

The full runbook — every secret and variable, the one-time server setup, the
exact `authorized_keys` line, how to trigger a manual deploy and how to roll back
by hand — lives in the backend repo, because the server-side wrapper it documents
serves both repos:

**`Restaurant_Backend/deploy/vps/README.md`**
and **`Restaurant_Backend/deploy/vps/WRAPPER_CONTRACT.md`**

Start there. It also carries the warning that the previously-exposed production
Supabase repository secrets are **still unrotated**, and must be rotated *before*
either deploy workflow merges.

This file covers only what is specific to this repo.

---

## The pipeline here

`.github/workflows/deploy.yml`, on push to `main`:

1. **ci** — invokes `dashboard-ci.yml` unchanged via `workflow_call` (lint,
   typecheck, `next build`, jest; Node 22).
2. **build_push** — asserts two invariants, builds the image, pushes it to
   `ghcr.io/dial-dost/restaurant_dashboard` as `:sha-<commit>` (immutable) and
   `:main` (BuildKit cache only), and outputs the digest.
3. **deploy** — requires the **backend** to be healthy, moves the `:prod` tag to
   the new digest, asks the VPS wrapper to converge the `dashboard` service,
   asserts the container was actually recreated, polls until healthy, and
   restores the tag + `rd-deploy rollback dashboard` if it does not come back.

There is **no migration gate** here, deliberately: this repo ships no SQL, and
the deploy is gated on a healthy backend, which implies a schema the backend
accepted. The server wrapper still gates *every* deploy, so a `65` from here
means a **backend** migration is pending — the workflow says so explicitly.

### How the image reaches the box

The wrapper on the VPS accepts no image reference of any kind; `rd-deploy deploy`
is just `docker compose up -d`. So the transport is GHCR and the deployment
pointer is the mutable `:prod` tag, which CI owns. That requires
`/opt/restaurant-dash/docker-compose.yml` to carry, for this service:

```yaml
  dashboard:
    image: ghcr.io/dial-dost/restaurant_dashboard:prod
    pull_policy: always
    # the read-only public/downloads bind mount stays exactly as it is
```

`pull_policy: always` is load-bearing — without it `up -d` reuses the image on
disk and the deploy is a silent no-op. The workflow asserts the container was
recreated and fails with that exact diagnosis if it was not. Full reasoning in
the backend runbook.

---

## Three build-time invariants the workflow asserts

All are silent when broken, which is why they are checked rather than trusted.

### `NEXT_PUBLIC_BACKEND_URL` is non-empty — asserted in the `Dockerfile` itself

This one is asserted in the image build, not only in CI, because the outage it
caused came from a build that never went through CI.

`ARG NEXT_PUBLIC_BACKEND_URL` originally had no default, so `ENV X=$ARG` on a
plain `docker build` produced an **empty string**. Every call site read it with
`?? 'http://localhost:3001'`, which does not fire on `""`, so the empty value
was baked into the browser bundle and every client base URL became `""`. The
dashboard then called its own origin: `POST /platform/auth/login` returned
Next's 404 HTML, `JSON.parse` reported
`Unexpected token '<', "<!DOCTYPE "...`, every counter read 0, and guest pages
reached by table QR codes broke on the same host.

The `ARG` now carries the `http://localhost:3001` default, and a `RUN` guard
before `npm run build` **fails the image build** if the value is blank, so the
hole is closed for manual builds too. A *localhost* value is deliberately still
accepted there — it is valid for a local build — and remains rejected by the
workflow check below for production.

Client code no longer reads the variable directly: `src/lib/backend-url.ts` is
the only reader, and it treats blank as unconfigured, falling back to the
same-origin `/backend-api` proxy in the browser.

### `ARG BACKEND_INTERNAL_URL` in the `Dockerfile`

`next.config.ts` uses `BACKEND_INTERNAL_URL` as the destination of the
`/backend-api/:path*` rewrite, and `output: 'standalone'` **serialises that
rewrite into the build manifest**. It is a build-time value despite not being
`NEXT_PUBLIC_*`; runtime env does not reach it.

Without the ARG, an image built from this Dockerfile bakes `localhost:3001` and
every guest page — `/order`, `/queue`, `/reserve`, `/cfd`, `/feedback` — breaks
in production, because a guest's phone cannot resolve the server's localhost.

The ARG carries the default `http://localhost:3001` on purpose. `ENV X=$ARG` with
an unset, default-less ARG yields an **empty string**, and `next.config.ts` reads
it with `?? 'http://localhost:3001'`, which does not fire on `""` — the rewrite
destination would collapse to `/:path*` and proxy to itself. Repeating the
default keeps a plain local `docker build` behaving as it does today. CI passes
the compose service name, `http://backend:3001`.

### `public/downloads` in `.dockerignore`

The ~94 MB APK and ~16 MB zip are git-tracked, but in production they are
**bind-mounted read-only** from `/opt/restaurant-dash/public/downloads` and are
deliberately not baked into the image. Without the ignore entry, every CI build
would push ~110 MB to the registry only for the mount to shadow it.

A deploy never writes to that directory, and the wrapper cannot be asked to.

**Consequence for local builds:** an image built without that bind mount serves
404 for `/downloads/*`. That is expected.

---

## The image is environment-specific

`NEXT_PUBLIC_*` values and the `/backend-api` rewrite are baked into the
standalone build, so this image **cannot be promoted to another environment
unchanged**. It is built for production and only for production. A staging
environment would need its own build with its own variables.

Repository variables consumed at build time (none is a secret — `NEXT_PUBLIC_*`
ships to every browser by definition, and `BACKEND_INTERNAL_URL` is a compose
service name):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_BACKEND_URL` | the public origin guests reach (the cloudflared hostname). The build **fails** if it is empty or contains `localhost` |
| `BACKEND_INTERNAL_URL` | `http://backend:3001` — defaults to this if unset |
| `NEXT_PUBLIC_FEEDBACK_FORM_URL` | leave unset unless the feedback form is hosted off-origin |
| `PUBLIC_DASHBOARD_URL` | optional; a public URL to probe after the deploy. A failure here only warns |

Plus the shared `DEPLOY_HOST` / `DEPLOY_USER` / `DEPLOY_PORT` / `SSH_KNOWN_HOSTS`
variables and the `DEPLOY_SSH_KEY` **environment** secret on `production`, all
documented in the backend runbook.

---

## Ordering against the backend

GitHub `concurrency:` groups are **per-repository**. They cannot serialise a
dashboard push against a backend push, and — contrary to an earlier draft of this
file — **there is no `flock` in the server wrapper**. Nothing serialises the two
repos.

What exists: this workflow refuses to deploy unless the `backend` service is
already healthy. That catches a backend that is down or mid-swap. It does not
catch a backend that is healthy now and swaps a second later.

Nothing here can co-deploy the two repos atomically, and there is no combined
rollback. **Ship API contract changes expand/contract:** add the field in the
backend and release it, then consume it here and release. Two deploys, decided by
a person who understands the contract. Do not push both repos at once.

Full discussion, including the consequences of an interleave and the optional
server-side `flock` that would remove the risk, is in
`Restaurant_Backend/deploy/vps/README.md`, *Cross-repo ordering*.

---

## Build reproducibility (resolved)

An earlier draft of this file flagged that `.dockerignore` excluded
`package-lock.json`, so the image resolved dependencies fresh with
`npm install --legacy-peer-deps`. **That is fixed.** The lockfile ships in the
build context, the `Dockerfile` `COPY`s it without a trailing glob (so a
re-ignored lockfile fails the build loudly instead of silently going unpinned),
and the image installs with `npm ci --legacy-peer-deps`. CI and the image build
on Node 22.
