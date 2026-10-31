import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Data is dynamic unless it is explicitly cached with `use cache`, so nothing
  // is prerendered from the database by accident (docs/architecture.md).
  cacheComponents: true,
  partialPrefetching: true,
  // Do not advertise the framework in response headers.
  poweredByHeader: false,
  // AGENTS.md is maintained by hand; `next dev` must not append to it.
  agentRules: false,
};

export default nextConfig;
