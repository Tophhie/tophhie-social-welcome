# tophhie-social-welcome

A minimal Cloudflare Worker (TypeScript) that renders a welcome HTML template for social signups. Includes a small worker entrypoint, a `welcome.html` template, and type definitions for static assets.

**Features**
- Server-side HTML template rendering for welcome messages
- TypeScript-based Cloudflare Worker
- Simple project structure suitable for Wrangler deployments

**Repository Structure**
- src/
  - index.ts — Worker entrypoint
  - templates/welcome.html — HTML template used by the worker
  - types/assets.d.ts — asset type definitions
- package.json — project dependencies and scripts
- tsconfig.json — TypeScript config
- wrangler.jsonc — Cloudflare Wrangler configuration

**Getting Started**
Prerequisites: Node.js (LTS), npm, and `wrangler` CLI installed and authenticated with Cloudflare.

1. Install dependencies
```bash
npm install
```

2. Build (if present) and run locally with Wrangler
```bash
# Local development
wrangler dev

# Build (if your project has a build script)
npm run build

# Publish to Cloudflare
wrangler publish
```

Note: If your `package.json` defines different scripts (e.g., `dev`, `start`, `build`), use those instead.

**Configuration**
- Edit `wrangler.jsonc` to configure account id, routes, and environment bindings.
- The worker reads the HTML template from `src/templates/welcome.html`; edit that file to customize email/content.

**Development Notes**
- Source is TypeScript at `src/index.ts`. Adjust `tsconfig.json` as needed for compilation targets.
- If you add static assets, update `src/types/assets.d.ts` accordingly.

**Contributing**
- Open issues or PRs for bugs and improvements.
- Keep changes minimal and tests focused if adding functionality.