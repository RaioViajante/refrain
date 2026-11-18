import type { NextConfig } from "next";

// Nothing is indexed until the owner decides otherwise: one constant on every
// response, never read from the environment.
const ROBOTS_HEADER = { key: "X-Robots-Tag", value: "noindex, nofollow" };

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: [ROBOTS_HEADER] }];
  },
};

export default nextConfig;
