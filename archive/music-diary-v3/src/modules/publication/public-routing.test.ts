import { describe, expect, it } from "vitest";

import { routePublicArchiveRequest } from "./public-routing";

// What an archive address answers (M3.8a), before anything is read: the
// switch first, then the method. The database is never asked, so this needs
// none.

const ON = { REFRAIN_PUBLIC_READS_ENABLED: "true" };

describe("routePublicArchiveRequest", () => {
  it("answers the unknown address to every method unless the switch is exactly true", () => {
    for (const value of [undefined, "", "TRUE", "1", "yes", "true ", " true"]) {
      for (const method of [
        "GET",
        "HEAD",
        "POST",
        "PUT",
        "DELETE",
        "OPTIONS",
      ]) {
        expect(
          routePublicArchiveRequest(
            { method },
            { REFRAIN_PUBLIC_READS_ENABLED: value },
          ),
          `${String(value)} ${method}`,
        ).toEqual({ action: "not_found" });
      }
    }
  });

  it("serves GET and HEAD with the switch on, and refuses every other method", () => {
    expect(routePublicArchiveRequest({ method: "GET" }, ON)).toEqual({
      action: "serve",
    });
    expect(routePublicArchiveRequest({ method: "HEAD" }, ON)).toEqual({
      action: "serve",
    });
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "get"]) {
      expect(routePublicArchiveRequest({ method }, ON), method).toEqual({
        action: "method_not_allowed",
      });
    }
  });
});
