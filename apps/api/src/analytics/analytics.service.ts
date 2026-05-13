import { aggregateCampaignAnalytics } from '@crmtool/analytics';
import type { CampaignAnalytics } from '@crmtool/types';
import { DeliveryService } from '../delivery/delivery.service.js';

export class AnalyticsService {
  constructor(private readonly delivery: DeliveryService) {}

  campaign(tenantId: string, campaignId: string): CampaignAnalytics {
    return aggregateCampaignAnalytics(campaignId, this.delivery.listMessages(tenantId));
  }
}
