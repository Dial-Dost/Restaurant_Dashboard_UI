# Restaurant Dashboard UI

Next.js 15 + Tailwind CSS dashboard for restaurant operations. It surfaces the same bookings, tables, audit logs, and menu data that the voice receptionist touches, and ships with a minimal public landing page so restaurants can promote the AI receptionist.

## Features

- Multi-surface dashboard: bookings, orders, tables, customers, analytics, audit logs.
- Auth context that simulates admin and employee roles per restaurant.
- Backend API persistence shared with the voice/backend services.
- Firebase-style landing page with animated sections and marketing copy.
- Genkit playground for iterating on AI copy or automations.

## Requirements

- Node.js 20+
- npm 10+
- Running backend API URL (local or deployed)
- Optional: Google/Firebase CLI if you deploy the marketing site with Firebase Hosting

## Getting Started

```bash
git clone https://github.com/Dial-Dost/Restaurant_Dashboard_UI.git
cd Restaurant_Dashboard_UI
cp .env.example .env.local   # create this file if it does not exist yet
npm install
npm run dev
```

The dev server runs on <http://localhost:9002>. Update `ALLOWED_ORIGINS` inside the backend repo so CORS allows the dashboard origin when you connect through the Node API.

### Environment Variables

Create `.env.local` with the following keys:

| Name | Required | Description |
| ---- | -------- | ----------- |
| `NEXT_PUBLIC_RECEPTION_API_URL` | Yes | Backend base URL (for example `http://localhost:3000`). |

> **Note:** Dashboard routes should use the backend API URL configured in `NEXT_PUBLIC_RECEPTION_API_URL`.

## NPM Scripts

| Script | What it does |
| ------ | ------------ |
| `npm run dev` | Starts Next.js with Turbopack on port 9002. |
| `npm run build` | Creates the production build (`.next/`). |
| `npm start` | Serves the production build. |
| `npm run lint` | Executes `next lint`. |
| `npm run typecheck` | TypeScript no-emit check. |
| `npm run test` | Runs Jest against the component/service tests. |
| `npm run genkit:dev` | Launches Genkit locally via `genkit start -- tsx src/ai/dev.ts`. |
| `npm run genkit:watch` | Same as above but watches the AI entrypoint. |

## Integrating With The Backend

1. Run the Restaurant Backend repo so the receptionist continues to push bookings (`npm run dev` inside `../Restaurant_Backend`).
2. Ensure the voice assistant and backend share the same `RECEPTION_RESTAURANT_ID`. The dashboard assumes `csrorganics` out of the box.
3. Visit `/dashboard/bookings` to see live updates as the receptionist writes data.

## Testing & Quality

- `npm run lint` and `npm run typecheck` should stay clean before submitting PRs.
- `npm run test` runs Jest with the config in `jest.config.ts` (uses `ts-jest`). Configure `NEXT_PUBLIC_RECEPTION_API_URL` if tests need to call a running backend.
- Use Storybook or Chromatic if you need visual regression coverage (not bundled yet).

## Continuous Integration

Add the provided `.github/workflows/dashboard-ci.yml` to run on push and pull request:

1. Install dependencies with `npm ci`.
2. Lint + typecheck.
3. Run Jest tests.
4. Build the app to ensure deploy readiness.

### Required Secrets

| Secret | Purpose |
| ------ | ------- |
| `NEXT_PUBLIC_RECEPTION_API_URL` | Backend base URL used by server actions and API-backed dashboard helpers. |

If you call the backend through REST, configure `NEXT_PUBLIC_RECEPTION_API_URL` in your deployment environment (Vercel, Firebase, etc.).

## Deployment

- **Vercel**: Set `NEXT_PUBLIC_RECEPTION_API_URL` in project settings, then `vercel deploy`.
- **Firebase Hosting**: Build with `npm run build`, then point `firebase.json` to `.next` via the Next.js adapter or host the static landing page while proxying `/dashboard` to Vercel.
- **Docker**: Create a simple `Dockerfile` using the Next.js `node:alpine` example if you need on-prem deployments.

## Folder Map

```text
src/
  app/
    dashboard/        # Authenticated dashboard routes
    (marketing)       # Landing pages and auth flows
  components/        # Landing + dashboard UI primitives
  context/           # Auth + language providers
  lib/               # API-backed data helpers, utils, mocked services
  services/          # Authentication + Firestore wrappers
docs/                # Design blueprint / product notes
```

Keep marketing assets (landing page) and operational UI consistent with the backend schema so that new restaurants can self-serve onboarding.
