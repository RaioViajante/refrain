import { describe, expect, it } from "vitest";

import type { DatabaseExecutor } from "@/db";
import { PublicationError } from "@/modules/publication";
// The gate's own mapping, tested directly. Tests may reach internals.
// eslint-disable-next-line no-restricted-imports
import { computeImpact } from "@/modules/publication/catalog-confirmation";

import { translateCatalogFailure } from "./commands";
import { CatalogError } from "./errors";

// ADR 0013 step 3, failing closed: a deadlock, a missing TEMPORARY privilege,
// or any failure to compute the public impact becomes a fixed code, never a
// database message; nothing was written (the transaction rolled back).

const ID = "00000000-0000-4000-8000-0000000000c1";

function failingDatabase(error: unknown): DatabaseExecutor {
  return {
    transaction: async () => {
      throw error;
    },
  } as unknown as DatabaseExecutor;
}

const pgError = (code: string, message = "secret detail: select …") =>
  Object.assign(new Error(message), { code });

describe("the catalog commands' fixed codes", () => {
  it.each([
    ["40P01", "retry"],
    ["40001", "retry"],
  ])("maps SQLSTATE %s to %s", (code, failure) => {
    const mapped = translateCatalogFailure(
      Object.assign(new Error("Failed query"), { cause: pgError(code) }),
    );
    expect(mapped).toBeInstanceOf(CatalogError);
    expect((mapped as CatalogError).failure).toBe(failure);
  });

  it.each([
    "confirmation_required",
    "confirmation_invalid",
    "confirmation_expired",
    "confirmation_stale",
    "impact_unavailable",
    "retry",
  ] as const)("passes the gate's %s on as a catalog refusal", (failure) => {
    const mapped = translateCatalogFailure(new PublicationError(failure));
    expect((mapped as CatalogError).failure).toBe(failure);
  });

  it("turns any other refusal of the gate into impact_unavailable", () => {
    const mapped = translateCatalogFailure(
      new PublicationError("entry_not_found"),
    );
    expect((mapped as CatalogError).failure).toBe("impact_unavailable");
  });
});

describe("the impact computation fails closed", () => {
  const change = [
    { op: "update_artist" as const, artistId: ID, name: "[Test] X" },
  ];

  it.each([
    ["a deadlock", pgError("40P01"), "retry"],
    ["a serialization failure", pgError("40001"), "retry"],
    ["a missing TEMPORARY privilege", pgError("42501"), "impact_unavailable"],
    ["a statement timeout", pgError("57014"), "impact_unavailable"],
    ["anything else", new Error("boom"), "impact_unavailable"],
  ])(
    "%s becomes a fixed code with no database detail",
    async (_n, error, failure) => {
      const refused = await computeImpact(failingDatabase(error), change).then(
        () => null,
        (reason: unknown) => reason,
      );
      expect(refused).toBeInstanceOf(PublicationError);
      expect((refused as PublicationError).failure).toBe(failure);
      expect(String((refused as Error).message)).not.toContain("secret detail");
    },
  );
});
