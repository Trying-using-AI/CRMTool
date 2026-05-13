# Local Docker Infrastructure

`docker-compose.yml` starts the Phase 1 local stack: PostgreSQL, Redis, API, web build, and worker build. PostgreSQL loads `apps/api/db/migrations/001_phase1_schema.sql` on first boot.
