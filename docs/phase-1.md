# Phase 1 MVP Implementation

This repository now contains a TypeScript monorepo for the CRM / customer engagement MVP.

## Included modules

- Auth and RBAC roles with password hashing and token issuance.
- Customer profiles with tenant scoping and identity-style upsert.
- Event ingestion with schema validation, deduplication hashes, profile resolution, and dead-letter capture.
- SQL-oriented segment definitions with materialized audience IDs.
- Template management with variable extraction and rendering.
- Campaign creation, launch, pause, and completion state transitions.
- Vendor abstraction with WhatsApp, SMS, and Email mock providers plus failover ordering.
- Delivery orchestration that creates messages, renders templates, calls vendors, and stores status.
- Basic campaign analytics for queued, sent, delivered, failed, opened, clicked, delivery rate, and CTR.
- Dashboard and campaign-builder frontend view-model helpers for marketer-facing screens.
- PostgreSQL Phase 1 schema migration and Docker Compose local services.

## API surface represented

- `POST /v1/events` behavior is implemented by `EventsService.ingest`.
- `POST /v1/segments` and `GET /v1/segments/:id` behavior is implemented by `SegmentsService`.
- `POST /v1/templates` and `GET /v1/templates` behavior is implemented by `TemplatesService`.
- `POST /v1/campaigns`, launch, and pause behavior is implemented by `CampaignsService` and `DeliveryService`.
- `POST /v1/vendors/test` behavior is represented by the provider `healthCheck` contract.

## Execution order covered

The code follows the master specification's sprint sequence through Phase 1: repo setup, auth, tenant-aware schema, profiles, event ingestion, segmentation, templates, campaigns, queue/delivery abstractions, vendor integrations, callback-ready tracking primitives, reporting metrics, dashboard helpers, and delivery logs storage.
