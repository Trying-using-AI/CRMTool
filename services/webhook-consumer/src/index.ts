export interface WebhookEnvelope {
  vendor: string;
  payload: Record<string, unknown>;
  receivedAt: string;
}
export function normalizeWebhook(envelope: WebhookEnvelope) {
  return { ...envelope, processed: false };
}
