# CRMTool

A modular CRM / customer engagement platform built as a TypeScript monorepo. Phase 1 implements the MVP foundation for campaign creation and delivery across WhatsApp, SMS, and Email with tenant-aware data modeling, segmentation, vendor abstraction, delivery tracking, and basic analytics.

## Structure

- `apps/api` — backend domain services, Phase 1 API composition, tests, and PostgreSQL migrations.
- `apps/web` — marketer-facing dashboard and campaign-builder view-model logic.
- `packages/types` — shared DTOs, enums, and validation helpers.
- `packages/vendor-core` — vendor-agnostic channel provider interface, registry, and failover.
- `packages/analytics` — campaign metrics aggregation.
- `services/worker`, `services/scheduler`, `services/webhook-consumer` — Phase 1 service boundaries for queues, delayed jobs, and callbacks.
- `infrastructure/docker` and `docker-compose.yml` — local PostgreSQL, Redis, API, web, and worker stack.
- `docs/phase-1.md` — implementation notes mapped to the master specification.

## Commands

```bash
npm install
npm test
npm run build
npm run lint
```
