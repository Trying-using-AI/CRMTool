import type { Campaign, CampaignAnalytics, Segment, Template } from '@crmtool/types';

export interface DashboardViewModel {
  performanceCards: Array<{ label: string; value: string }>;
  recentCampaigns: Campaign[];
  templates: Template[];
  segments: Segment[];
  failureAlerts: string[];
}

export function buildDashboardViewModel(input: {
  campaigns: Campaign[];
  analytics: CampaignAnalytics[];
  templates: Template[];
  segments: Segment[];
}): DashboardViewModel {
  const delivered = input.analytics.reduce((sum, item) => sum + item.delivered, 0);
  const sent = input.analytics.reduce((sum, item) => sum + item.sent, 0);
  const clicked = input.analytics.reduce((sum, item) => sum + item.clicked, 0);
  return {
    performanceCards: [
      { label: 'Campaigns', value: String(input.campaigns.length) },
      {
        label: 'Delivery rate',
        value: sent === 0 ? '0%' : `${Math.round((delivered / sent) * 100)}%`,
      },
      {
        label: 'CTR',
        value: delivered === 0 ? '0%' : `${Math.round((clicked / delivered) * 100)}%`,
      },
    ],
    recentCampaigns: input.campaigns.slice(-5).reverse(),
    templates: input.templates,
    segments: input.segments,
    failureAlerts: input.analytics
      .filter((item) => item.failed > 0)
      .map((item) => `${item.failed} failed messages in ${item.campaignId}`),
  };
}
