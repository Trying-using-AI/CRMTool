import { AnalyticsService } from './analytics/analytics.service.js';
import { AuthService } from './auth/auth.service.js';
import { CampaignsService } from './campaigns/campaigns.service.js';
import { DeliveryService } from './delivery/delivery.service.js';
import { EventsService } from './events/events.service.js';
import { ProfilesService } from './profiles/profiles.service.js';
import { SegmentsService } from './segments/segments.service.js';
import { TemplatesService } from './templates/templates.service.js';
import { createDefaultVendorRegistry } from './vendors/vendors.service.js';

export function createCrmApplication() {
  const auth = new AuthService();
  const profiles = new ProfilesService();
  const events = new EventsService(profiles);
  const segments = new SegmentsService(profiles);
  const templates = new TemplatesService();
  const campaigns = new CampaignsService();
  const vendors = createDefaultVendorRegistry();
  const delivery = new DeliveryService(campaigns, segments, templates, profiles, vendors);
  const analytics = new AnalyticsService(delivery);
  return { auth, profiles, events, segments, templates, campaigns, vendors, delivery, analytics };
}
