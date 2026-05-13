import {
  assertSegmentDefinition,
  type CustomerProfile,
  type Segment,
  type SegmentDefinition,
  type SegmentRule,
} from '@crmtool/types';
import { InMemoryRepository, now } from '../common/repository.js';
import { ProfilesService } from '../profiles/profiles.service.js';

const isGroup = (rule: SegmentRule | SegmentDefinition): rule is SegmentDefinition =>
  'rules' in rule;

export class SegmentsService {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly segments = new InMemoryRepository<Segment>(),
  ) {}

  create(input: Omit<Segment, 'id' | 'createdAt' | 'audienceProfileIds'>): Segment {
    const definition = assertSegmentDefinition(input.definition);
    const audienceProfileIds = this.materialize(input.tenantId, definition);
    return this.segments.create({ ...input, definition, audienceProfileIds, createdAt: now() });
  }

  refresh(segmentId: string): Segment {
    const segment = this.get(segmentId);
    return this.segments.update(segmentId, {
      audienceProfileIds: this.materialize(segment.tenantId, segment.definition),
    });
  }

  get(id: string): Segment {
    const segment = this.segments.findById(id);
    if (!segment) throw new Error(`Segment not found: ${id}`);
    return segment;
  }

  list(tenantId: string): Segment[] {
    return this.segments.list(tenantId);
  }

  private materialize(tenantId: string, definition: SegmentDefinition): string[] {
    return this.profiles
      .list(tenantId)
      .filter((profile) => this.matchesGroup(profile, definition))
      .map((profile) => profile.id);
  }

  private matchesGroup(profile: CustomerProfile, group: SegmentDefinition): boolean {
    const results = group.rules.map((rule) =>
      isGroup(rule) ? this.matchesGroup(profile, rule) : this.matchesRule(profile, rule),
    );
    return group.operator === 'AND' ? results.every(Boolean) : results.some(Boolean);
  }

  private matchesRule(profile: CustomerProfile, rule: SegmentRule): boolean {
    const value = this.fieldValue(profile, rule.field);
    switch (rule.operator) {
      case 'equals':
        return value === rule.value;
      case 'not_equals':
        return value !== rule.value;
      case 'contains':
        return String(value ?? '').includes(String(rule.value ?? ''));
      case 'greater_than':
        return Number(value) > Number(rule.value);
      case 'less_than':
        return Number(value) < Number(rule.value);
      case 'between':
        return (
          Array.isArray(rule.value) &&
          Number(value) >= Number(rule.value[0]) &&
          Number(value) <= Number(rule.value[1])
        );
      case 'exists':
        return value !== undefined && value !== null;
      case 'in':
        return Array.isArray(rule.value) && rule.value.includes(value);
      case 'not_in':
        return Array.isArray(rule.value) && !rule.value.includes(value);
    }
  }

  private fieldValue(profile: CustomerProfile, field: string): unknown {
    const direct = profile[field as keyof CustomerProfile];
    return direct ?? profile.attributes[field];
  }
}
