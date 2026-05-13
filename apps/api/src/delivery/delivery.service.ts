import type { CustomerProfile, Message } from '@crmtool/types';
import type { SendMessageRequest } from '@crmtool/vendor-core';
import { VendorRegistry } from '@crmtool/vendor-core';
import { InMemoryRepository, now } from '../common/repository.js';
import { CampaignsService } from '../campaigns/campaigns.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { SegmentsService } from '../segments/segments.service.js';
import { TemplatesService } from '../templates/templates.service.js';

export class DeliveryService {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly segments: SegmentsService,
    private readonly templates: TemplatesService,
    private readonly profiles: ProfilesService,
    private readonly vendors: VendorRegistry,
    private readonly messages = new InMemoryRepository<Message>(),
  ) {}

  async launchCampaign(campaignId: string): Promise<Message[]> {
    const campaign = this.campaigns.launch(campaignId);
    const segment = this.segments.refresh(campaign.segmentId);
    const template = this.templates.get(campaign.templateId);
    const profiles = this.profiles
      .list(campaign.tenantId)
      .filter((profile) => segment.audienceProfileIds.includes(profile.id));
    const sent: Message[] = [];
    for (const profile of profiles) {
      const renderedContent = this.templates.render(template.id, this.templateData(profile));
      const queued = this.messages.create({
        tenantId: campaign.tenantId,
        campaignId: campaign.id,
        profileId: profile.id,
        channel: campaign.channel,
        vendor: 'pending',
        renderedContent,
        status: 'queued',
        createdAt: now(),
      });
      const response = await this.vendors.sendWithFailover(
        this.requestFor(campaign.tenantId, queued, profile),
      );
      sent.push(
        this.messages.update(queued.id, {
          vendor: response.vendor,
          status: response.status,
          sentAt: now(),
        }),
      );
    }
    this.campaigns.complete(campaign.id);
    return sent;
  }

  updateStatus(messageId: string, status: Message['status']): Message {
    return this.messages.update(messageId, {
      status,
      deliveredAt: status === 'delivered' ? now() : undefined,
    });
  }

  listMessages(tenantId: string): Message[] {
    return this.messages.list(tenantId);
  }

  private requestFor(
    tenantId: string,
    message: Message,
    profile: CustomerProfile,
  ): SendMessageRequest {
    return {
      tenantId,
      profileId: profile.id,
      channel: message.channel,
      to: profile.email ?? profile.phone ?? profile.externalId,
      renderedContent: message.renderedContent,
      idempotencyKey: message.id,
    };
  }

  private templateData(profile: CustomerProfile): Record<string, unknown> {
    return {
      ...profile.attributes,
      first_name: profile.firstName,
      last_name: profile.lastName,
      city: profile.city,
      email: profile.email,
      phone: profile.phone,
    };
  }
}
