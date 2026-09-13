import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone", // lean image for Dockerfile — traced deps only
  allowedDevOrigins: ["127.0.0.1"],
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    // Headroom above avatarConfig.maxSizeBytes (5MB) for multipart/form-data boundary/field
    // overhead — the only server-action file upload left; Documents uploads go direct-to-storage
    // and never hit this limit. See src/config/avatar.ts.
    serverActions: {
      bodySizeLimit: "6mb"
    }
  }
};

export default nextConfig;
