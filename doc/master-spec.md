# CRM / Customer Engagement Platform — Master Build Specification

## Objective

Build a modular CRM / customer engagement platform that allows non-technical marketing, growth, and product teams to:

* Send WhatsApp, SMS, and Email campaigns
* Create audience segments
* Trigger campaigns based on events
* Build journeys / automation flows
* Track delivery and engagement
* Switch vendors easily
* Operate without engineering help

The system should be:

* Modular
* API-first
* Vendor-agnostic
* Multi-tenant ready
* Easy to scale later
* Optimized for simplicity first
* Built as a modular monolith initially

This document is written so that:

* Any AI IDE / coding agent can implement it
* Engineering teams can directly execute it
* Product managers can understand system boundaries

---

# 1. PRODUCT PRINCIPLES

## Primary Product Goals

1. Fast campaign creation
2. Reliable message delivery
3. Easy vendor switching
4. Understandable segmentation
5. Strong analytics visibility
6. Non-technical usability
7. Low operational overhead

---

# 2. CORE MODULES

The platform should contain the following modules.

## Core Modules

1. Authentication & RBAC
2. User Profiles & Identity Resolution
3. Event Ingestion Pipeline
4. Audience / Segmentation Engine
5. Template Management
6. Campaign Management
7. Journey / Flow Engine
8. Channel Abstraction Layer
9. Vendor Integrations
10. Delivery Engine
11. Scheduling Engine
12. Tracking & Analytics
13. Reporting
14. Audit Logs
15. Suppression & Preferences
16. Webhook Processing
17. Admin & Settings

---

# 3. RECOMMENDED TECH STACK

## Frontend

### Framework

* Next.js
* React
* TypeScript
* TailwindCSS
* shadcn/ui

### State Management

* React Query
* Zustand

### Form Builder

* React Hook Form

### Flow Builder

* React Flow

---

## Backend

### API Layer

* Node.js
* NestJS
* TypeScript

Reason:

* Strong modularity
* Excellent DI system
* Easy scaling
* Enterprise-friendly structure

---

## Database

### Primary DB

* PostgreSQL

Reason:

* Strong relational support
* JSON support
* Mature ecosystem
* Great indexing
* Works well for segmentation

---

## Queue System

### Recommended

* BullMQ + Redis

Used for:

* Campaign sends
* Retries
* Delayed jobs
* Scheduled jobs
* Webhook processing

---

## Event Bus

### MVP

* PostgreSQL + Queue

### Scale Phase

* Kafka

---

## Cache

* Redis

Used for:

* Rate limits
* Frequency capping
* Session cache
* Segment cache

---

## Analytics Store

### MVP

* PostgreSQL

### Scale

* ClickHouse

---

## File Storage

* AWS S3

Used for:

* Attachments
* CSV imports
* Export files
* Logs

---

## Authentication

* JWT
* Refresh tokens
* Role-based access control

---

## Hosting

### Recommended

* AWS

Use:

* ECS or EC2
* RDS PostgreSQL
* ElastiCache Redis
* S3
* CloudWatch

---

# 4. SYSTEM ARCHITECTURE

## Architecture Style

### MVP

Use:

* Modular monolith

Do NOT start with:

* Microservices

Reason:

* Faster development
* Easier debugging
* Lower DevOps complexity
* Smaller team friendly

---

## Recommended High-Level Structure

Frontend
↓
API Gateway / Backend
↓
Modules:

* Campaigns
* Segments
* Templates
* Events
* Vendors
* Analytics
* Auth
  ↓
  PostgreSQL
  Redis
  BullMQ
  S3

---

# 5. MONOREPO STRUCTURE

Use:

* Turborepo or Nx

## Suggested Structure

/apps
/web
/api

/packages
/ui
/types
/sdk
/vendor-core
/analytics

/services
/workers
/scheduler
/webhook-consumer

/infrastructure
/terraform
/docker
/k8s

---

# 6. DATABASE DESIGN

## Multi-Tenant Design

Every table should contain:

* tenant_id

Reason:

* Future SaaS support
* Better isolation

---

## Core Tables

### tenants

Fields:

* id
* name
* subdomain
* created_at

Indexes:

* unique(subdomain)

---

### users

Fields:

* id
* tenant_id
* email
* password_hash
* role
* created_at

Indexes:

* unique(email)

---

### customer_profiles

Fields:

* id
* tenant_id
* external_id
* phone
* email
* first_name
* last_name
* city
* lifecycle_stage
* attributes JSONB
* created_at
* updated_at

Indexes:

* tenant_id + phone
* tenant_id + email
* gin(attributes)

---

### identities

Fields:

* id
* tenant_id
* profile_id
* type
* value

Examples:

* email
* phone
* device_id
* customer_id

---

### events

Fields:

* id
* tenant_id
* profile_id
* event_name
* event_time
* properties JSONB
* source
* schema_version

Indexes:

* profile_id
* event_name
* event_time
* gin(properties)

Partition:

* monthly partitioning

---

### segments

Fields:

* id
* tenant_id
* name
* definition JSONB
* type
* created_by
* created_at

---

### campaigns

Fields:

* id
* tenant_id
* name
* channel
* status
* segment_id
* template_id
* schedule_type
* scheduled_at
* created_by
* created_at

Statuses:

* draft
* review
* approved
* scheduled
* running
* paused
* completed

---

### templates

Fields:

* id
* tenant_id
* channel
* name
* body
* variables JSONB
* vendor_template_mapping JSONB

---

### messages

Fields:

* id
* tenant_id
* campaign_id
* profile_id
* channel
* vendor
* rendered_content
* status
* error_code
* sent_at
* delivered_at
* created_at

Indexes:

* campaign_id
* profile_id
* status

---

### message_status_history

Fields:

* id
* message_id
* old_status
* new_status
* source
* created_at

---

### vendor_integrations

Fields:

* id
* tenant_id
* channel
* vendor_name
* encrypted_credentials
* config JSONB
* active

---

### webhook_logs

Fields:

* id
* vendor
* payload JSONB
* processed
* received_at

---

### suppression_lists

Fields:

* id
* tenant_id
* profile_id
* channel
* reason
* created_at

---

### audit_logs

Fields:

* id
* tenant_id
* user_id
* entity_type
* entity_id
* action
* changes JSONB
* created_at

---

# 7. EVENT INGESTION ARCHITECTURE

## Sources

The system must support:

* Web events
* Mobile app events
* Backend server events
* Vendor callbacks
* CRM events
* Commerce events

---

## Event Ingestion API

POST /v1/events

Payload:

```json
{
  "tenant_id": "t_123",
  "external_user_id": "u_123",
  "event_name": "purchase_completed",
  "event_time": "2026-05-13T10:00:00Z",
  "properties": {
    "amount": 5000,
    "category": "electronics"
  }
}
```

---

## Event Pipeline Steps

1. Validate schema
2. Deduplicate
3. Resolve identity
4. Store raw event
5. Enqueue downstream jobs
6. Trigger journeys
7. Update derived attributes
8. Trigger campaign conditions

---

## Event Deduplication

Use:

* event_id
* hash fingerprint

Store:

* processed_event_hashes

---

## Dead Letter Queue

Failed events must move to:

* dead_letter_events

---

# 8. SEGMENTATION ENGINE

## MVP Recommendation

Use:

* SQL-based segmentation
* Materialized audiences
* Background refresh jobs

Do NOT start with:

* Real-time stream segmentation

---

## Segment Types

### Static Segment

Manually uploaded or fixed list.

---

### Dynamic Segment

Rule-based auto-updating audience.

Example:

Users where:

* city = Bangalore
  AND
* last_purchase_amount > 5000
  AND
* opened_email_in_last_30_days = true

---

## Segment Definition Example

```json
{
  "operator": "AND",
  "rules": [
    {
      "field": "city",
      "operator": "equals",
      "value": "Bangalore"
    },
    {
      "field": "last_purchase_amount",
      "operator": "greater_than",
      "value": 5000
    }
  ]
}
```

---

## Supported Operators

* equals
* not_equals
* contains
* greater_than
* less_than
* between
* exists
* in
* not_in

---

## Event-Based Conditions

Examples:

* Purchased in last 7 days
* Clicked campaign within 30 days
* Did not open email in 60 days

---

## Segment Refresh Strategy

### MVP

Batch refresh every:

* 15 mins
* 1 hour

---

### Scale Phase

Hybrid:

* real-time updates
* event-driven recalculation

---

# 9. TEMPLATE ENGINE

## Requirements

Support:

* Email templates
* WhatsApp templates
* SMS templates

---

## Variables

Example:

```txt
Hi {{first_name}}, your order of ₹{{amount}} has shipped.
```

---

## Template Features

* Preview mode
* Test send
* Variable validation
* Version history
* Draft / publish

---

# 10. VENDOR ABSTRACTION LAYER

This is one of the most important components.

Goal:

* Add any vendor with minimal engineering effort.

---

## Core Interface

```ts
interface ChannelProvider {
  send(message: SendMessageRequest): Promise<SendMessageResponse>

  validateTemplate(template: Template): Promise<boolean>

  mapStatus(payload: any): NormalizedStatus

  healthCheck(): Promise<boolean>
}
```

---

## Supported Channels

* WhatsApp
* SMS
* Email

---

## Adapter Examples

* Meta WhatsApp API
* Twilio
* MSG91
* SendGrid
* SES
* Mailgun

---

## Vendor Features

Must support:

* Credential management
* Rate limits
* Retry policies
* Vendor failover
* Vendor-specific mappings
* Idempotency
* Callback normalization

---

## Message Status Normalization

Normalize all vendor statuses into:

* queued
* sent
* accepted
* delivered
* failed
* read
* opened
* clicked
* bounced
* unsubscribed

---

## Failover Logic

Example:

Primary SMS Vendor:

* MSG91

Fallback:

* Twilio

If:

* timeout
* vendor unavailable
* rate limit exceeded

Switch automatically.

---

# 11. DELIVERY ENGINE

## Responsibilities

* Queue messages
* Process sends
* Retry failures
* Apply throttling
* Apply frequency caps
* Respect quiet hours

---

## Retry Strategy

Use exponential backoff.

Example:

* 1 min
* 5 mins
* 15 mins
* 1 hour

---

## Frequency Capping

Examples:

* Max 2 SMS/day
* Max 5 pushes/week

---

## Quiet Hours

Example:

* Do not send after 10 PM

---

# 12. JOURNEY / FLOW ENGINE

## MVP

Keep simple.

Support:

* Trigger
* Wait
* Send message
* Condition branch

---

## Flow Nodes

* Trigger
* Delay
* Condition
* Send WhatsApp
* Send Email
* Send SMS
* Exit

---

## Example Journey

Purchase Completed
↓
Wait 1 day
↓
Send WhatsApp
↓
If clicked
→ Send coupon
Else
→ Send reminder

---

## Flow Storage

Store flow graph as JSON.

---

# 13. TRACKING & ANALYTICS

## Track Metrics

Per:

* campaign
* vendor
* channel
* journey
* segment

---

## Core Metrics

* queued
* sent
* delivered
* failed
* opened
* clicked
* replied
* unsubscribed
* conversion

---

## Reports Dashboard

Must show:

* delivery rate
* CTR
* conversion rate
* vendor comparison
* top campaigns
* failure reasons

---

## Raw vs Normalized Data

Store:

1. Raw vendor payloads
2. Normalized event records

Never discard raw payloads.

---

# 14. UI / UX DESIGN

The UI must prioritize:

* simplicity
* speed
* marketer usability

---

# 15. SCREEN-BY-SCREEN UX

## Dashboard

Components:

* Campaign performance cards
* Delivery metrics
* Recent campaigns
* Active journeys
* Failure alerts

---

## Campaign List

Columns:

* name
* status
* channel
* audience size
* sent
* delivered
* CTR
* created by

Actions:

* duplicate
* pause
* archive

---

## Campaign Builder

Steps:

1. Choose channel
2. Choose template
3. Choose audience
4. Configure schedule
5. Preview
6. Test send
7. Launch

---

## Segment Builder

Use:

* visual rule builder

Support:

* AND
* OR
* nested conditions

---

## Flow Builder

Use drag-and-drop.

Built using:

* React Flow

---

## Vendor Settings

Support:

* add vendor
* test connection
* configure credentials
* set failover

---

## Reports Dashboard

Charts:

* delivery trends
* CTR trends
* vendor comparison
* campaign funnel

---

## Delivery Logs

Search by:

* user
* phone
* email
* message id

---

# 16. SECURITY

## Must Have

* Encrypted credentials
* Audit logs
* RBAC
* JWT auth
* API rate limiting
* Webhook verification
* IP allowlisting

---

# 17. ROLE-BASED ACCESS CONTROL

Roles:

* Admin
* Marketer
* Analyst
* Viewer

---

# 18. APPROVAL SYSTEM

Support:

* Draft
* Review
* Approved
* Rejected
* Published

Campaigns above thresholds may require approvals.

---

# 19. API DESIGN

## Campaign APIs

### Create Campaign

POST /v1/campaigns

### Launch Campaign

POST /v1/campaigns/:id/launch

### Pause Campaign

POST /v1/campaigns/:id/pause

---

## Segment APIs

POST /v1/segments
GET /v1/segments/:id

---

## Template APIs

POST /v1/templates
GET /v1/templates

---

## Vendor APIs

POST /v1/vendors
POST /v1/vendors/test

---

# 20. DEPLOYMENT STRATEGY

## Local Development

Use Docker Compose.

Services:

* postgres
* redis
* api
* web
* worker

---

## Production

Recommended:

* ECS Fargate

---

# 21. OBSERVABILITY

Must include:

* structured logs
* tracing
* metrics
* alerting

Recommended:

* Grafana
* Prometheus
* OpenTelemetry

---

# 22. ENGINEERING ROADMAP

# PHASE 1 — MVP

Goal:
Enable campaign creation and delivery.

Build:

* Auth
* Profiles
* Event ingestion
* Segments
* Campaigns
* Templates
* Vendor abstraction
* WhatsApp integration
* Email integration
* SMS integration
* Delivery tracking
* Basic analytics

Do NOT build:

* advanced journeys
* experimentation
* AI recommendations
* real-time segmentation
* multi-region infra

Success Metrics:

* Campaign launched successfully
* Vendor switching works
* Delivery tracking visible
* Segment generation works

---

# PHASE 2 — GROWTH

Build:

* Journey builder
* Advanced analytics
* Better reporting
* Approval workflows
* Frequency capping
* A/B testing
* Better caching

---

# PHASE 3 — SCALE

Build:

* Kafka
* ClickHouse
* Real-time segmentation
* Microservices split
* Multi-region deployment
* Streaming analytics

---

# 23. HIDDEN COMPLEXITIES

## Hard Problems

1. Identity resolution
2. Vendor inconsistency
3. WhatsApp template approvals
4. Rate limiting
5. Delivery retries
6. Segment performance
7. Multi-channel deduplication
8. Analytics correctness
9. Flow execution consistency
10. Scheduling reliability

---

# 24. THINGS TO AVOID EARLY

Do NOT:

* Over-engineer infra
* Build custom stream processing early
* Split into microservices too soon
* Build a no-code engine too early
* Support every vendor initially

---

# 25. INITIAL ENGINEERING TEAM

Recommended Team:

1 Product Manager
2 Backend Engineers
1 Frontend Engineer
1 DevOps/Fullstack Engineer
1 QA Engineer

---

# 26. RECOMMENDED INITIAL VENDORS

## WhatsApp

* Meta Cloud API

## SMS

* MSG91
* Twilio

## Email

* SendGrid
* AWS SES

---

# 27. TENANT ISOLATION STRATEGY

## MVP

Shared DB with tenant_id.

---

## Enterprise Scale

Optional:

* separate DB per tenant

---

# 28. SUBDOMAIN STRATEGY

Support:

tenantname.yourcrm.com

Store in:

* tenants table

---

# 29. SCHEDULER DESIGN

Use:

* BullMQ delayed jobs

Responsibilities:

* campaign launch
* recurring campaigns
* retries
* flow waits

---

# 30. MESSAGE FLOW

Campaign Created
↓
Audience Selected
↓
Users Resolved
↓
Messages Generated
↓
Queue Created
↓
Vendor Adapter Called
↓
Vendor Response Stored
↓
Callbacks Received
↓
Statuses Updated
↓
Analytics Aggregated

---

# 31. RECOMMENDED GITHUB STRUCTURE

Root:

* README.md
* docs/
* apps/
* services/
* packages/
* docker-compose.yml
* turbo.json

---

# 32. DEVELOPMENT EXECUTION ORDER

## Sprint 1

* Repo setup
* Auth
* DB setup
* Tenant model
* Customer profiles

---

## Sprint 2

* Events API
* Segment engine
* Templates

---

## Sprint 3

* Campaign creation
* Queue system
* Delivery workers

---

## Sprint 4

* Vendor integrations
* Callback handling
* Tracking

---

## Sprint 5

* Reporting
* Dashboard
* Logs

---

## Sprint 6

* Journeys
* Approvals
* Scheduling improvements

---

# 33. WHAT AI CODING AGENTS SHOULD FOLLOW

All generated code must:

* Use TypeScript
* Use clean architecture
* Use repository pattern
* Be modular
* Be testable
* Use DTO validation
* Use migrations
* Use environment configs
* Include OpenAPI docs
* Include Docker support

---

# 34. REQUIRED ENGINEERING STANDARDS

## Backend

* ESLint
* Prettier
* Zod validation
* Swagger docs
* Unit tests

---

## Frontend

* Responsive UI
* Type-safe APIs
* Reusable components
* Loading states
* Error boundaries

---

# 35. FINAL RECOMMENDATION

Do not attempt to build:

* a CleverTap clone
* a MoEngage clone
* a Braze clone

in version 1.

Instead:

Build:

* a reliable communication orchestration platform
* with strong vendor abstraction
* understandable segmentation
* strong delivery visibility
* simple UX

The biggest differentiator initially will NOT be:

* AI
* advanced analytics
* deep automation

It will be:

* reliability
* simplicity
* fast execution
* operational visibility
* ease of use
* low engineering dependence

Focus on:

* reliable delivery
* clean abstractions
* stable scheduling
* understandable UI
* good reporting

Everything else can evolve later.
