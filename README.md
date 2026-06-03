# Autonomous Trading Engine (Gate.io, USDT-base)

A single-user, paper-first autonomous **spot** trading dashboard for Gate.io:
React PWA → Supabase Edge Functions → Gate.io v4. Built around a hard **safety
floor** (DRY_RUN default, risk caps, kill switch, no leverage) with institutional
governance (formal invariants, risk posture, Shadow/Canary, deterministic replay)
and an honest **edge detector** that must pass before going live.

> ⚠️ Not a guaranteed money-maker. Defaults to DRY_RUN (real data, no live orders).
> Going LIVE is a deliberate, owner-only action with a least-privilege, IP-restricted key.

### 📚 Documentation
- [`docs/RUN-LOCAL.md`](docs/RUN-LOCAL.md) — **install & operate it on your own computer** (recommended)
- [`docs/PROJECT-STATUS.md`](docs/PROJECT-STATUS.md) — what's done, what needs your runtime, how to verify
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/ARCHITECTURE-DIAGRAM.md`](docs/ARCHITECTURE-DIAGRAM.md) — system map & diagrams
- [`docs/MASTER-SPEC.md`](docs/MASTER-SPEC.md) — full blueprint + 100-item traceability matrix
- [`docs/INSTITUTIONAL-SPEC.md`](docs/INSTITUTIONAL-SPEC.md) — Layers 2 & 3 (invariants, governance, replay)
- [`docs/TRADING-GUIDE.md`](docs/TRADING-GUIDE.md) — methodology, Gate.io rules, when-to/when-not
- [`docs/SECURITY-AND-ROADMAP.md`](docs/SECURITY-AND-ROADMAP.md) — findings, fixes, staged plan
- [`docs/LOVABLE-PROMPT.md`](docs/LOVABLE-PROMPT.md) — one prompt to regenerate the system

Quick start: `deno test supabase/functions/_shared/` (proofs) · `npm i && npm run dev` (dashboard).
Safety/run details in `PROJECT-STATUS.md`.

---

# Welcome to your Lovable project

## Project info

**URL**: https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)
