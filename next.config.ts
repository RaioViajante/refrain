import type { NextConfig } from "next";

// Baseline headers on every response. Each is a constant, never read from
// the environment. A full Content-Security-Policy comes with the first page
// that loads media or scripts beyond the framework's own.
export const BASELINE_HEADERS = [
  // Nothing is indexed until the owner decides otherwise.
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
  // No other site may frame any page (clickjacking).
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
] as const;

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // Photograph uploads go through Server Actions; the server itself
    // refuses anything over 4 MB (src/server/media/image-file.ts).
    serverActions: { bodySizeLimit: "5mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: [...BASELINE_HEADERS] }];
  },
};

export default nextConfig;
