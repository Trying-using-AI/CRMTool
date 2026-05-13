export type Channel = 'whatsapp' | 'sms' | 'email';
export type CampaignStatus =
  | 'draft'
  | 'review'
  | 'approved'
  | 'scheduled'
  | 'running'
  | 'paused'
  | 'completed';
export type MessageStatus =
  | 'queued'
  | 'sent'
  | 'accepted'
  | 'delivered'
  | 'failed'
  | 'read'
  | 'opened'
  | 'clicked'
  | 'bounced'
  | 'unsubscribed';
export type Role = 'admin' | 'marketer' | 'analyst' | 'viewer';
export type SegmentOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'greater_than'
  | 'less_than'
  | 'between'
  | 'exists'
  | 'in'
  | 'not_in';

export interface SegmentRule {
  field: string;
  operator: SegmentOperator;
  value?: unknown;
}
export interface SegmentDefinition {
  operator: 'AND' | 'OR';
  rules: Array<SegmentRule | SegmentDefinition>;
}
export interface EventIngestionRequest {
  tenant_id: string;
  external_user_id: string;
  event_id?: string;
  event_name: string;
  event_time: string;
  properties: Record<string, unknown>;
  source: string;
  schema_version: string;
}
export interface TenantScopedEntity {
  id: string;
  tenantId: string;
  createdAt: string;
}
export interface CustomerProfile extends TenantScopedEntity {
  externalId: string;
  phone?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  city?: string;
  lifecycleStage?: string;
  attributes: Record<string, unknown>;
  updatedAt: string;
}
export interface Template extends TenantScopedEntity {
  channel: Channel;
  name: string;
  body: string;
  variables: string[];
  vendorTemplateMapping: Record<string, unknown>;
  status: 'draft' | 'published';
}
export interface Segment extends TenantScopedEntity {
  name: string;
  definition: SegmentDefinition;
  type: 'static' | 'dynamic';
  createdBy: string;
  audienceProfileIds: string[];
}
export interface Campaign extends TenantScopedEntity {
  name: string;
  channel: Channel;
  status: CampaignStatus;
  segmentId: string;
  templateId: string;
  scheduleType: 'immediate' | 'scheduled';
  scheduledAt?: string;
  createdBy: string;
}
export interface Message extends TenantScopedEntity {
  campaignId: string;
  profileId: string;
  channel: Channel;
  vendor: string;
  renderedContent: string;
  status: MessageStatus;
  errorCode?: string;
  sentAt?: string;
  deliveredAt?: string;
}
export interface CampaignAnalytics {
  campaignId: string;
  queued: number;
  sent: number;
  delivered: number;
  failed: number;
  opened: number;
  clicked: number;
  deliveryRate: number;
  ctr: number;
}

export function parseEventIngestion(payload: unknown): EventIngestionRequest {
  const input = payload as Partial<EventIngestionRequest> | null;
  if (!input || typeof input !== 'object') throw new Error('Event payload must be an object');
  if (!input.tenant_id || !input.external_user_id || !input.event_name || !input.event_time)
    throw new Error('Event payload missing required fields');
  if (Number.isNaN(Date.parse(input.event_time))) throw new Error('event_time must be an ISO date');
  return {
    tenant_id: input.tenant_id,
    external_user_id: input.external_user_id,
    event_id: input.event_id,
    event_name: input.event_name,
    event_time: input.event_time,
    properties: input.properties ?? {},
    source: input.source ?? 'api',
    schema_version: input.schema_version ?? '1.0',
  };
}

export function assertSegmentDefinition(definition: SegmentDefinition): SegmentDefinition {
  if (
    !['AND', 'OR'].includes(definition.operator) ||
    !Array.isArray(definition.rules) ||
    definition.rules.length === 0
  )
    throw new Error('Invalid segment definition');
  return definition;
}
