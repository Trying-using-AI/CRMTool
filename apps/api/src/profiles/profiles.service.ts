import type { CustomerProfile } from '@crmtool/types';
import { InMemoryRepository, now } from '../common/repository.js';

export class ProfilesService {
  constructor(private readonly profiles = new InMemoryRepository<CustomerProfile>()) {}

  upsert(
    input: Omit<CustomerProfile, 'id' | 'createdAt' | 'updatedAt' | 'attributes'> & {
      attributes?: Record<string, unknown>;
    },
  ): CustomerProfile {
    const existing = this.profiles
      .list(input.tenantId)
      .find(
        (profile) =>
          profile.externalId === input.externalId ||
          (input.email !== undefined && profile.email === input.email) ||
          (input.phone !== undefined && profile.phone === input.phone),
      );
    if (existing) {
      return this.profiles.update(existing.id, {
        ...input,
        attributes: { ...existing.attributes, ...input.attributes },
        updatedAt: now(),
      });
    }
    return this.profiles.create({
      ...input,
      attributes: input.attributes ?? {},
      createdAt: now(),
      updatedAt: now(),
    });
  }

  list(tenantId: string): CustomerProfile[] {
    return this.profiles.list(tenantId);
  }
}
