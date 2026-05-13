import type { CampaignAnalytics, Message } from '@crmtool/types';

export function aggregateCampaignAnalytics(
  campaignId: string,
  messages: Message[],
): CampaignAnalytics {
  const campaignMessages = messages.filter((message) => message.campaignId === campaignId);
  const count = (status: Message['status']) =>
    campaignMessages.filter((m) => m.status === status).length;
  const sent = count('sent') + count('delivered') + count('opened') + count('clicked');
  const delivered = count('delivered') + count('opened') + count('clicked');
  const opened = count('opened') + count('clicked');
  const clicked = count('clicked');
  return {
    campaignId,
    queued: count('queued'),
    sent,
    delivered,
    failed: count('failed') + count('bounced'),
    opened,
    clicked,
    deliveryRate: sent === 0 ? 0 : delivered / sent,
    ctr: delivered === 0 ? 0 : clicked / delivered,
  };
}
