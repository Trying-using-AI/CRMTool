import type { Campaign, Channel, Segment, Template } from '@crmtool/types';

export const campaignBuilderSteps = [
  'Choose channel',
  'Choose template',
  'Choose audience',
  'Configure schedule',
  'Preview',
  'Test send',
  'Launch',
] as const;

export function canLaunchCampaignDraft(
  input: Partial<Campaign>,
  templates: Template[],
  segments: Segment[],
): boolean {
  return Boolean(
    input.name &&
    input.channel &&
    input.templateId &&
    input.segmentId &&
    templates.some(
      (template) =>
        template.id === input.templateId && template.channel === (input.channel as Channel),
    ) &&
    segments.some((segment) => segment.id === input.segmentId),
  );
}
