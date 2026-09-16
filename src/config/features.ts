export const featureConfig = {
  billing: true,
  organizations: true,
  credits: true,
  documents: true,
  entities: true,
  // specs/05 Dashboard IA — nav placeholders, invisible until Phase 3/4 build them out.
  imports: true,
  rules: false,
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
