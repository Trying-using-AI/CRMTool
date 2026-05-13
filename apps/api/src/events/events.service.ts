import { createHash } from 'node:crypto';
import { parseEventIngestion, type EventIngestionRequest } from '@crmtool/types';
import { ProfilesService } from '../profiles/profiles.service.js';

export interface StoredEvent {
  id: string;
  tenantId: string;
  profileId: string;
  eventName: string;
  eventTime: string;
  properties: Record<string, unknown>;
  source: string;
  schemaVersion: string;
  hash: string;
}

export class EventsService {
  private readonly processedHashes = new Set<string>();
  private readonly events: StoredEvent[] = [];
  private readonly deadLetters: Array<{ payload: unknown; reason: string }> = [];

  constructor(private readonly profiles: ProfilesService) {}

  ingest(payload: unknown): StoredEvent {
    let input: EventIngestionRequest;
    try {
      input = parseEventIngestion(payload);
    } catch (error) {
      this.deadLetters.push({
        payload,
        reason: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    const hash = this.fingerprint(input);
    const existing = this.events.find(
      (event) => event.tenantId === input.tenant_id && event.hash === hash,
    );
    if (existing) {
      return existing;
    }
    this.processedHashes.add(hash);
    const profile = this.profiles.upsert({
      tenantId: input.tenant_id,
      externalId: input.external_user_id,
    });
    const event: StoredEvent = {
      id: input.event_id ?? hash,
      tenantId: input.tenant_id,
      profileId: profile.id,
      eventName: input.event_name,
      eventTime: input.event_time,
      properties: input.properties,
      source: input.source,
      schemaVersion: input.schema_version,
      hash,
    };
    this.events.push(event);
    return event;
  }

  list(tenantId: string): StoredEvent[] {
    return this.events.filter((event) => event.tenantId === tenantId);
  }

  deadLetterEvents() {
    return this.deadLetters;
  }

  private fingerprint(input: EventIngestionRequest): string {
    return createHash('sha256')
      .update(
        JSON.stringify(
          input.event_id
            ? [input.tenant_id, input.source, input.event_id]
            : [
                input.tenant_id,
                input.external_user_id,
                input.event_name,
                input.event_time,
                input.properties,
              ],
        ),
      )
      .digest('hex');
  }
}
