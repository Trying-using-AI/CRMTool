import test from 'node:test';
import assert from 'node:assert/strict';
import { createCrmApplication } from '../src/app.js';

test('phase 1 CRM MVP ingests events, materializes segment, sends campaign, and reports analytics', async () => {
  const app = createCrmApplication();
  const tenantId = 't_123';
  app.auth.register(tenantId, 'marketer@example.com', 'secret', 'admin');
  app.profiles.upsert({
    tenantId,
    externalId: 'u_123',
    email: 'buyer@example.com',
    firstName: 'Asha',
    city: 'Bangalore',
    attributes: { last_purchase_amount: 6000 },
  });
  const event = app.events.ingest({
    tenant_id: tenantId,
    external_user_id: 'u_123',
    event_name: 'purchase_completed',
    event_time: '2026-05-13T10:00:00Z',
    properties: { amount: 6000 },
  });
  assert.equal(event.eventName, 'purchase_completed');
  const segment = app.segments.create({
    tenantId,
    name: 'High value Bangalore buyers',
    type: 'dynamic',
    createdBy: 'user_1',
    definition: {
      operator: 'AND',
      rules: [
        { field: 'city', operator: 'equals', value: 'Bangalore' },
        { field: 'last_purchase_amount', operator: 'greater_than', value: 5000 },
      ],
    },
  });
  assert.equal(segment.audienceProfileIds.length, 1);
  const template = app.templates.create({
    tenantId,
    channel: 'email',
    name: 'Shipping update',
    body: 'Hi {{first_name}}, your order has shipped.',
    vendorTemplateMapping: {},
    status: 'published',
  });
  const campaign = app.campaigns.create({
    tenantId,
    name: 'Post purchase update',
    channel: 'email',
    segmentId: segment.id,
    templateId: template.id,
    scheduleType: 'immediate',
    createdBy: 'user_1',
    status: 'approved',
  });
  const messages = await app.delivery.launchCampaign(campaign.id);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].vendor, 'sendgrid');
  assert.equal(app.analytics.campaign(tenantId, campaign.id).sent, 1);
});

test('event ingestion deduplicates by explicit event_id', () => {
  const app = createCrmApplication();
  const payload = {
    tenant_id: 't_123',
    external_user_id: 'u_123',
    event_id: 'evt_1',
    event_name: 'login',
    event_time: '2026-05-13T10:00:00Z',
    properties: {},
  };
  assert.equal(app.events.ingest(payload).id, app.events.ingest(payload).id);
  assert.equal(app.events.list('t_123').length, 1);
});
