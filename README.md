# KCS SENTINEL

KCS SENTINEL is a modular biometric school attendance platform built to operate independently today and integrate into the KCS ORBIT ecosystem later through secure APIs.

## Stack

- Frontend: React, Vite, TailwindCSS, TypeScript
- Backend: Node.js, Express, TypeScript
- Database target: PostgreSQL
- Security baseline: JWT, RBAC, biometric template encryption, audit logging

## Architecture

```text
apps/
  api/   Express API with biometric, attendance, notification, auth, and dashboard modules
  web/   React dashboard and operational interface
```

The first version ships with a mock biometric provider and in-memory repositories so the product can be demonstrated without hardware. The biometric layer is isolated behind provider interfaces for later fingerprint SDK and facial recognition integration.

## Key Modules

- Biometric enrollment and verification
- Live attendance dashboard
- Parent notification preview pipeline
- JWT-ready authentication and RBAC middleware
- Audit-friendly attendance event model
- AI-readiness surfaces for analytics, anomalies, and prediction
- Student disciplinary register with period summaries
- PDF export for printable disciplinary records
- Configurable school calendar for holidays and non-school days

## Run

```bash
npm install
npm run build
```

Development:

```bash
npm run dev:api
npm run dev:web
```

The frontend expects the API at `http://localhost:4000` by default.

## Local Access

- API: `http://localhost:4000/api`
- Web on this machine: `http://localhost:5173/`
- Web on the local network: `http://192.168.1.93:5173/`

## Mobile And Tablet Installation

KCS SENTINEL now includes:

- a web manifest,
- a service worker,
- standalone app mode,
- touch-first entrance UI,
- install prompt support.

This makes the app suitable for tablet or phone deployment at the school entrance.

### Important Note

For a phone or tablet to install the app as a real PWA, the browser usually requires a secure origin:

- `http://localhost` works on the same device,
- `http://192.168.x.x` is fine for viewing on the local network,
- but full installability on another mobile device generally requires `https`.

### Recommended Next Deployment Step

For production or real entrance devices, deploy the frontend behind HTTPS and run it in one of these modes:

- Android tablet in kiosk mode
- managed iPad home-screen app mode
- Capacitor wrapper if native device controls are later required

## PostgreSQL Setup

The API now expects PostgreSQL for persistent attendance storage.

1. Create a database named `kcs_sentinel`.
2. Copy [apps/api/.env.example](apps/api/.env.example) to `.env` or export the variables in your environment.
3. Ensure `DATABASE_URL` points to a reachable PostgreSQL server.

On startup, the API creates the required tables and seeds the first students automatically.

## Entrance Kiosk Mode

The web app now includes:

- a fullscreen `Poste d'entrée` screen,
- fingerprint scan simulation,
- visual arrival confirmation,
- hold-to-unlock kiosk UX,
- school-branded app icon and browser tab icon.

## Disciplinary Register

The dashboard now includes a student disciplinary register with:

- daily, weekly, monthly, and yearly attendance frequency,
- exact entry and exit timestamps,
- traceable attendance history,
- PDF export for archiving and school administration.

## School Calendar

Administrators can configure calendar exceptions from the web interface:

- holidays,
- non-school days,
- exceptional school days.

These rules are applied to the disciplinary attendance calculations so non-working days are not counted as absences.

## GitHub Pages Deployment

GitHub Pages can host the frontend only. The Node/Express API and PostgreSQL database must stay on a separate backend host if you want live biometric scans and persistent attendance online.

If you only need a public demo frontend, the project is now prepared for GitHub Pages:

1. Push the repository to GitHub.
2. In the repository settings, enable GitHub Pages with `GitHub Actions` as the source.
3. The workflow in `.github/workflows/deploy-pages.yml` will build `apps/web` with the correct base path.

The published site URL follows this format:

```text
https://<github-username>.github.io/kcs-sentinel/
```

For a live production deployment with the real API, use GitHub Pages only for the frontend and configure the backend separately.
