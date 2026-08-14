export const featureConfig = {
  billing: true,
  organizations: true,
  credits: true,
  files: true,
  admin: true,
  notifications: true,
  mfa: true,
  outgoingWebhooks: false,
  cookieConsent: false
} as const;

export type FeatureKey = keyof typeof featureConfig;

export function isFeatureEnabled(feature: FeatureKey) {
  return featureConfig[feature];
}
