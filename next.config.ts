import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone", // lean image for Dockerfile — traced deps only
  allowedDevOrigins: ["127.0.0.1"],
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    // Above filesConfig.categories.document.maxSizeBytes (20MB), with headroom for
    // multipart/form-data boundary/field overhead — see src/config/files.ts.
    serverActions: {
      bodySizeLimit: "21mb"
    }
  }
};

export default nextConfig;
