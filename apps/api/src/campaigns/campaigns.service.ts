import type { Campaign } from '@crmtool/types';
import { InMemoryRepository, now } from '../common/repository.js';

export class CampaignsService {
  constructor(private readonly campaigns = new InMemoryRepository<Campaign>()) {}

  create(
    input: Omit<Campaign, 'id' | 'createdAt' | 'status'> & { status?: Campaign['status'] },
  ): Campaign {
    return this.campaigns.create({ ...input, status: input.status ?? 'draft', createdAt: now() });
  }

  launch(id: string): Campaign {
    const campaign = this.get(id);
    if (!['approved', 'scheduled', 'draft'].includes(campaign.status)) {
      throw new Error(`Campaign ${id} cannot launch from ${campaign.status}`);
    }
    return this.campaigns.update(id, { status: 'running' });
  }

  pause(id: string): Campaign {
    return this.campaigns.update(id, { status: 'paused' });
  }

  complete(id: string): Campaign {
    return this.campaigns.update(id, { status: 'completed' });
  }

  get(id: string): Campaign {
    const campaign = this.campaigns.findById(id);
    if (!campaign) throw new Error(`Campaign not found: ${id}`);
    return campaign;
  }

  list(tenantId: string): Campaign[] {
    return this.campaigns.list(tenantId);
  }
}
