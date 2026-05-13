import { MockChannelProvider, VendorRegistry } from '@crmtool/vendor-core';

export function createDefaultVendorRegistry(): VendorRegistry {
  const registry = new VendorRegistry();
  registry.register(new MockChannelProvider('meta-cloud-api', 'whatsapp'));
  registry.register(new MockChannelProvider('msg91', 'sms'));
  registry.register(new MockChannelProvider('twilio', 'sms'));
  registry.register(new MockChannelProvider('sendgrid', 'email'));
  registry.register(new MockChannelProvider('aws-ses', 'email'));
  return registry;
}
