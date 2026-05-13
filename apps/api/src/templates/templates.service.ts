import type { Channel, Template } from '@crmtool/types';
import { InMemoryRepository, now } from '../common/repository.js';

export class TemplatesService {
  constructor(private readonly templates = new InMemoryRepository<Template>()) {}

  create(
    input: Omit<Template, 'id' | 'createdAt' | 'variables' | 'status'> & {
      status?: Template['status'];
    },
  ): Template {
    return this.templates.create({
      ...input,
      variables: extractVariables(input.body),
      status: input.status ?? 'draft',
      createdAt: now(),
    });
  }

  get(id: string): Template {
    const template = this.templates.findById(id);
    if (!template) throw new Error(`Template not found: ${id}`);
    return template;
  }

  list(tenantId: string, channel?: Channel): Template[] {
    return this.templates
      .list(tenantId)
      .filter((template) => !channel || template.channel === channel);
  }

  render(id: string, data: Record<string, unknown>): string {
    const template = this.get(id);
    return template.body.replaceAll(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key: string) =>
      String(data[key] ?? ''),
    );
  }
}

export function extractVariables(body: string): string[] {
  return [...new Set([...body.matchAll(/{{\s*([a-zA-Z0-9_]+)\s*}}/g)].map((match) => match[1]))];
}
