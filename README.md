# International TMS

国际零担运输管理系统。当前基础版本包含运营后台、客户门户、基础数据、客户与销售管理以及权限安全。

## Sites

- Operations: `/admin`, prepared for `admin.oulingtruck.com`
- Customer portal: `/portal`, prepared for `portal.oulingtruck.com`
- The sites share one organization-scoped D1 database but enforce separate session types and authorization boundaries.

## Current modules

- Cloudflare Workers + React Router + TypeScript
- Cloudflare D1 schema and versioned migrations
- One-time protected system bootstrap
- Organization-level tenant isolation
- Secure password hashing and server-side sessions
- Users, memberships, roles and fine-grained permissions
- Reference data for countries, currencies, units, transport modes, service levels and lead sources
- Customer 360 records, contacts, addresses, credit terms and customer portal accounts
- Sales leads, opportunities, pipeline stages and activities
- Separate operations and customer portal authentication
- Login lockout, session monitoring and session revocation
- Security audit trail
- Pull-request CI and protected automatic production deployment from `main`

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

## Production deployment

Merges to `main` automatically run validation, D1 migrations and the Cloudflare
Workers deployment through the protected GitHub `production` environment.

The workflow can also be started manually through **Deploy production**. Bind the
future custom domains to the same Worker; hostname routing already recognizes
`admin.oulingtruck.com` and `portal.oulingtruck.com`.

Never commit `.dev.vars`, `.env`, tokens, passwords, keys, or customer data.
