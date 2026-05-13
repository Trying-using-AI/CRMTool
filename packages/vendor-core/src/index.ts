import type { Channel, MessageStatus, Template } from '@crmtool/types';

export interface SendMessageRequest {
  tenantId: string;
  profileId: string;
  channel: Channel;
  to: string;
  renderedContent: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export interface SendMessageResponse {
  vendor: string;
  vendorMessageId: string;
  status: MessageStatus;
  raw: Record<string, unknown>;
}

export interface ChannelProvider {
  readonly vendorName: string;
  readonly channel: Channel;
  send(message: SendMessageRequest): Promise<SendMessageResponse>;
  validateTemplate(template: Template): Promise<boolean>;
  mapStatus(payload: unknown): MessageStatus;
  healthCheck(): Promise<boolean>;
}

export class MockChannelProvider implements ChannelProvider {
  constructor(
    public readonly vendorName: string,
    public readonly channel: Channel,
  ) {}

  async send(message: SendMessageRequest): Promise<SendMessageResponse> {
    return {
      vendor: this.vendorName,
      vendorMessageId: `${this.vendorName}_${message.idempotencyKey}`,
      status: 'sent',
      raw: { accepted: true, channel: this.channel },
    };
  }

  async validateTemplate(template: Template): Promise<boolean> {
    return template.channel === this.channel && template.body.trim().length > 0;
  }

  mapStatus(payload: unknown): MessageStatus {
    const status = (payload as { status?: string })?.status;
    if (
      status === 'delivered' ||
      status === 'read' ||
      status === 'opened' ||
      status === 'clicked'
    ) {
      return status;
    }
    if (status === 'failed' || status === 'bounced' || status === 'unsubscribed') {
      return status;
    }
    return 'accepted';
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

export class VendorRegistry {
  private readonly providers = new Map<string, ChannelProvider[]>();

  register(provider: ChannelProvider): void {
    const existing = this.providers.get(provider.channel) ?? [];
    this.providers.set(provider.channel, [...existing, provider]);
  }

  getPrimary(channel: Channel): ChannelProvider {
    const providers = this.providers.get(channel) ?? [];
    const provider = providers[0];
    if (!provider) {
      throw new Error(`No provider registered for ${channel}`);
    }
    return provider;
  }

  async sendWithFailover(request: SendMessageRequest): Promise<SendMessageResponse> {
    const providers = this.providers.get(request.channel) ?? [];
    let lastError: unknown;
    for (const provider of providers) {
      try {
        if (await provider.healthCheck()) {
          return await provider.send(request);
        }
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`All providers failed for ${request.channel}: ${String(lastError)}`);
  }
}
