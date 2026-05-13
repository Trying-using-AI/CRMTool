import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboardViewModel } from './dashboard.js';

test('dashboard view model shows phase 1 delivery metrics', () => {
  const view = buildDashboardViewModel({
    campaigns: [],
    templates: [],
    segments: [],
    analytics: [
      {
        campaignId: 'c1',
        queued: 0,
        sent: 10,
        delivered: 8,
        failed: 1,
        opened: 3,
        clicked: 2,
        deliveryRate: 0.8,
        ctr: 0.25,
      },
    ],
  });
  assert.deepEqual(
    view.performanceCards.map((card) => card.value),
    ['0', '80%', '25%'],
  );
  assert.equal(view.failureAlerts.length, 1);
});
