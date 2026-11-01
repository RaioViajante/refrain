import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  languageVersionsWithStatus,
  publicLanguageVersions,
  publicTrackReflectionTexts,
} from "./predicate";

// The public fragments are the parameterized builders applied to one value.
// This pins that value, so a live public query can never be given another.

const dialect = new PgDialect();
const render = (fragment: SQL) => dialect.sqlToQuery(fragment);

describe("the public publication predicate", () => {
  it("selects only published versions, on entries that are not deleted", () => {
    const { sql, params } = render(publicLanguageVersions);
    expect(params).toEqual(["published"]);
    expect(sql).toContain("e.deleted_at is null");
    expect(sql).toContain("t.status = $1");
  });

  it("selects reflection texts only through a published version", () => {
    const { sql, params } = render(publicTrackReflectionTexts);
    expect(params).toEqual(["published"]);
    expect(sql).toContain("where tr.is_published");
    expect(sql).toContain("pv.locale = trt.locale");
  });

  it("binds the requested status for the disclosure, and never inlines it", () => {
    for (const status of ["draft", "private", "published"] as const) {
      const { sql, params } = render(languageVersionsWithStatus(status));
      expect(params).toEqual([status]);
      expect(sql).not.toContain(`'${status}'`);
    }
  });
});
