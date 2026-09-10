import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lean production image for infra/docker-compose.yml's `web` service — copies only the
  // traced dependency subset instead of full node_modules. See Dockerfile.
  output: "standalone",
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
