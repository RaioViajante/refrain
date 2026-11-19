// Request-scoped reads shared by layouts and pages.
import "server-only";

import { cache } from "react";

import { getDatabase } from "@/db/client";

import { getSiteImages } from "./public-queries";

/** Fixed photograph slots on public pages, filled from the Studio. */
export const IMAGE_SLOTS = {
  footerRoad: "footer.road",
  footerRoadMobile: "footer.road_mobile",
} as const;

export const getFooterImages = cache(() =>
  getSiteImages(getDatabase(), [
    IMAGE_SLOTS.footerRoad,
    IMAGE_SLOTS.footerRoadMobile,
  ]),
);
