import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone", // lean image for Dockerfile — traced deps only
  allowedDevOrigins: ["127.0.0.1"],
  poweredByHeader: false,
  reactStrictMode: true,
  // re2 (src/lib/safe-regex.ts) ships a native .node binary — webpack tries to parse it as JS
  // and fails the build unless it's excluded from bundling and left as a real `require()` at
  // runtime instead (Node resolves native addons directly; nothing to bundle for a
  // server-only module).
  serverExternalPackages: ["re2"],
  experimental: {
    // Headroom above avatarConfig.maxSizeBytes (5MB) for multipart/form-data boundary/field
    // overhead — the only server-action file upload left; Documents uploads go direct-to-storage
    // and never hit this limit. See src/config/avatar.ts.
    serverActions: {
      bodySizeLimit: "6mb"
    }
  }
};

export default withNextIntl(nextConfig);
