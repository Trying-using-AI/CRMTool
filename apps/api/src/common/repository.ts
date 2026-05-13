import { randomUUID } from 'node:crypto';

export interface Repository<T extends { id: string; tenantId?: string }> {
  create(entity: Omit<T, 'id'> & { id?: string }): T;
  findById(id: string): T | undefined;
  list(tenantId?: string): T[];
  update(id: string, patch: Partial<T>): T;
}

export class InMemoryRepository<
  T extends { id: string; tenantId?: string },
> implements Repository<T> {
  private readonly records = new Map<string, T>();

  create(entity: Omit<T, 'id'> & { id?: string }): T {
    const record = { ...entity, id: entity.id ?? randomUUID() } as T;
    this.records.set(record.id, record);
    return record;
  }

  findById(id: string): T | undefined {
    return this.records.get(id);
  }

  list(tenantId?: string): T[] {
    const values = [...this.records.values()];
    return tenantId ? values.filter((record) => record.tenantId === tenantId) : values;
  }

  update(id: string, patch: Partial<T>): T {
    const current = this.findById(id);
    if (!current) {
      throw new Error(`Record not found: ${id}`);
    }
    const next = { ...current, ...patch };
    this.records.set(id, next);
    return next;
  }
}

export const now = () => new Date().toISOString();
