CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  subdomain text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'marketer', 'analyst', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE customer_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  external_id text NOT NULL,
  phone text,
  email text,
  first_name text,
  last_name text,
  city text,
  lifecycle_stage text,
  attributes jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_profiles_tenant_phone_idx ON customer_profiles(tenant_id, phone);
CREATE INDEX customer_profiles_tenant_email_idx ON customer_profiles(tenant_id, email);
CREATE INDEX customer_profiles_attributes_gin_idx ON customer_profiles USING gin(attributes);

CREATE TABLE identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  profile_id uuid NOT NULL REFERENCES customer_profiles(id),
  type text NOT NULL,
  value text NOT NULL
);

CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  profile_id uuid NOT NULL REFERENCES customer_profiles(id),
  event_name text NOT NULL,
  event_time timestamptz NOT NULL,
  properties jsonb NOT NULL DEFAULT '{}',
  source text NOT NULL,
  schema_version text NOT NULL
);
CREATE INDEX events_profile_id_idx ON events(profile_id);
CREATE INDEX events_event_name_idx ON events(event_name);
CREATE INDEX events_event_time_idx ON events(event_time);
CREATE INDEX events_properties_gin_idx ON events USING gin(properties);

CREATE TABLE processed_event_hashes (hash text PRIMARY KEY, processed_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE dead_letter_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payload jsonb NOT NULL, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  definition jsonb NOT NULL,
  type text NOT NULL CHECK (type IN ('static', 'dynamic')),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  channel text NOT NULL CHECK (channel IN ('whatsapp', 'sms', 'email')),
  name text NOT NULL,
  body text NOT NULL,
  variables jsonb NOT NULL DEFAULT '[]',
  vendor_template_mapping jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('whatsapp', 'sms', 'email')),
  status text NOT NULL CHECK (status IN ('draft', 'review', 'approved', 'scheduled', 'running', 'paused', 'completed')),
  segment_id uuid NOT NULL REFERENCES segments(id),
  template_id uuid NOT NULL REFERENCES templates(id),
  schedule_type text NOT NULL CHECK (schedule_type IN ('immediate', 'scheduled')),
  scheduled_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  profile_id uuid NOT NULL REFERENCES customer_profiles(id),
  channel text NOT NULL,
  vendor text NOT NULL,
  rendered_content text NOT NULL,
  status text NOT NULL,
  error_code text,
  sent_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_campaign_id_idx ON messages(campaign_id);
CREATE INDEX messages_profile_id_idx ON messages(profile_id);
CREATE INDEX messages_status_idx ON messages(status);

CREATE TABLE message_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES messages(id),
  old_status text,
  new_status text NOT NULL,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vendor_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  channel text NOT NULL,
  vendor_name text NOT NULL,
  encrypted_credentials text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE webhook_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vendor text NOT NULL, payload jsonb NOT NULL, processed boolean NOT NULL DEFAULT false, received_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE suppression_lists (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), profile_id uuid NOT NULL REFERENCES customer_profiles(id), channel text NOT NULL, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE audit_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), user_id uuid REFERENCES users(id), entity_type text NOT NULL, entity_id uuid NOT NULL, action text NOT NULL, changes jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
