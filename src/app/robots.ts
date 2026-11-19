import type { MetadataRoute } from "next";

import { isIndexable } from "@/lib/indexing";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return isIndexable()
    ? { rules: { userAgent: "*", allow: "/", disallow: ["/studio"] } }
    : { rules: { userAgent: "*", disallow: "/" } };
}
