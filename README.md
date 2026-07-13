# International TMS

国际零担运输管理系统。第一阶段按模块交付，当前模块为“系统基础、用户、组织与权限”。

## Current module

- Cloudflare Workers + React Router + TypeScript
- Cloudflare D1 schema and versioned migrations
- One-time protected system bootstrap
- Organization-level tenant isolation
- Secure password hashing and server-side sessions
- Users, memberships, roles and fine-grained permissions
- Security audit trail
- Pull-request CI and protected manual production deployment

## Local setup

Requirements: Node.js 22 or newer.

```bash
npm ci
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

Set a long random `BOOTSTRAP_TOKEN` in `.dev.vars`. Open `/setup` once to create the
first organization and owner. The setup route disables itself after the first user
exists.

## Verification

```bash
npm run ci
```

This runs generated Cloudflare types, React Router route types, TypeScript checks,
unit tests, and a production build.

## Production provisioning

Production deployment intentionally remains manual until the Cloudflare account is
authorized. Before the first deployment:

1. Create the production D1 database and replace the placeholder `database_id` in
   `wrangler.jsonc`.
2. Add `BOOTSTRAP_TOKEN` as a Worker secret.
3. Add `CLOUDFLARE_ACCOUNT_ID` and a least-privilege `CLOUDFLARE_API_TOKEN` to the
   protected GitHub `production` environment.
4. Run the **Deploy production** workflow.

Never commit `.dev.vars`, `.env`, tokens, passwords, keys, or customer data.
