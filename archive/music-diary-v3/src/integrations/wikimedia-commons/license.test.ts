import { describe, expect, it } from "vitest";

import {
  canonicalDeedUrl,
  matchPhotoLicense,
  PHOTO_LICENSES,
  photoLicenseNamed,
  type LicenseMetadata,
} from "./license";

const ccBySa4: LicenseMetadata = {
  licenseShortName: "CC BY-SA 4.0",
  license: "cc-by-sa-4.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
  attributionRequired: "true",
  copyrighted: "True",
  nonFree: "",
};

describe("the license allowlist", () => {
  it("is exactly CC0, the public domain, and CC BY and CC BY-SA 2.0 to 4.0", () => {
    expect(PHOTO_LICENSES.map((license) => license.name)).toEqual([
      "CC0",
      "Public domain",
      "CC BY 4.0",
      "CC BY-SA 4.0",
      "CC BY 3.0",
      "CC BY-SA 3.0",
      "CC BY 2.5",
      "CC BY-SA 2.5",
      "CC BY 2.0",
      "CC BY-SA 2.0",
    ]);
    expect(photoLicenseNamed("CC BY-SA 3.0")).toMatchObject({
      url: "https://creativecommons.org/licenses/by-sa/3.0/",
      attributionRequired: true,
      shareAlike: true,
    });
    expect(photoLicenseNamed("Public domain")).toMatchObject({ url: null });
    expect(photoLicenseNamed("CC BY-NC 4.0")).toBeNull();
  });

  it("canonicalizes Creative Commons deed addresses", () => {
    const by = "https://creativecommons.org/licenses/by/4.0/";
    for (const value of [
      "https://creativecommons.org/licenses/by/4.0",
      "https://creativecommons.org/licenses/by/4.0/",
      "http://creativecommons.org/licenses/by/4.0/deed.en",
      "https://creativecommons.org/licenses/by/4.0/deed.pt-BR",
      " https://creativecommons.org/licenses/by/4.0 ",
    ]) {
      expect(canonicalDeedUrl(value)).toBe(by);
    }
    for (const value of [
      "https://creativecommons.org.evil.example/licenses/by/4.0/",
      "https://creativecommons.org:8443/licenses/by/4.0/",
      "https://user@creativecommons.org/licenses/by/4.0/",
      "https://creativecommons.org/licenses/by/4.0/?x=1",
      "javascript:alert(1)",
      "ftp://creativecommons.org/licenses/by/4.0/",
      "https://creativecommons.org/",
      "not a url",
    ]) {
      expect(canonicalDeedUrl(value)).toBeNull();
    }
  });
});

describe("matching a file's license", () => {
  it("accepts the live shapes of CC BY-SA, CC BY, CC0, and the public domain", () => {
    expect(matchPhotoLicense(ccBySa4)).toMatchObject({
      ok: true,
      license: { name: "CC BY-SA 4.0" },
    });
    expect(
      matchPhotoLicense({
        licenseShortName: "CC BY-SA 2.0",
        license: "cc-by-sa-2.0",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/2.0",
        attributionRequired: "true",
        copyrighted: "True",
        nonFree: "",
      }),
    ).toMatchObject({ ok: true, license: { name: "CC BY-SA 2.0" } });
    expect(
      matchPhotoLicense({
        licenseShortName: "CC0",
        license: "cc0",
        licenseUrl: "http://creativecommons.org/publicdomain/zero/1.0/deed.en",
        attributionRequired: "false",
        // Commons says True for CC0 files too (seen live).
        copyrighted: "True",
        nonFree: "",
      }),
    ).toMatchObject({ ok: true, license: { name: "CC0" } });
    expect(
      matchPhotoLicense({
        licenseShortName: "Public domain",
        license: "pd",
        licenseUrl: "",
        attributionRequired: "false",
        copyrighted: "False",
        nonFree: "",
      }),
    ).toMatchObject({ ok: true, license: { name: "Public domain" } });
  });

  it.each<[string, Partial<LicenseMetadata>, string]>([
    [
      "non-commercial",
      {
        licenseShortName: "CC BY-NC-SA 4.0",
        license: "cc-by-nc-sa-4.0",
        licenseUrl: "https://creativecommons.org/licenses/by-nc-sa/4.0",
      },
      "unsupported_license",
    ],
    [
      "no derivatives",
      {
        licenseShortName: "CC BY-ND 4.0",
        license: "cc-by-nd-4.0",
        licenseUrl: "https://creativecommons.org/licenses/by-nd/4.0",
      },
      "unsupported_license",
    ],
    [
      "a jurisdiction port",
      {
        licenseShortName: "CC BY-SA 3.0 de",
        license: "cc-by-sa-3.0-de",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/de/",
      },
      "unsupported_license",
    ],
    [
      "GFDL",
      {
        licenseShortName: "GFDL",
        license: "gfdl",
        licenseUrl: "https://www.gnu.org/copyleft/fdl.html",
      },
      "unsupported_license",
    ],
    [
      "no license at all",
      { licenseShortName: "", license: "", licenseUrl: "" },
      "unsupported_license",
    ],
    [
      "a code that disagrees with the name",
      { license: "cc-by-4.0" },
      "license_mismatch",
    ],
    [
      "a name that disagrees with the code",
      { licenseShortName: "CC BY 4.0" },
      "license_mismatch",
    ],
    [
      "a deed that disagrees",
      { licenseUrl: "https://creativecommons.org/licenses/by/4.0" },
      "license_mismatch",
    ],
    [
      "a port's deed under an accepted code",
      { licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/de/" },
      "license_mismatch",
    ],
    [
      "a deed on another host",
      { licenseUrl: "https://example.org/licenses/by-sa/4.0" },
      "license_mismatch",
    ],
    ["no deed", { licenseUrl: "" }, "license_mismatch"],
    [
      "attribution said not to be required",
      { attributionRequired: "false" },
      "license_mismatch",
    ],
    ["attribution not stated", { attributionRequired: "" }, "license_mismatch"],
    ["marked non-free", { nonFree: "true" }, "non_free"],
  ])("refuses %s", (_label, overrides, refusal) => {
    expect(matchPhotoLicense({ ...ccBySa4, ...overrides })).toEqual({
      ok: false,
      refusal,
    });
  });

  it("refuses a public-domain mark that disagrees with itself", () => {
    const pd = {
      licenseShortName: "Public domain",
      license: "pd",
      licenseUrl: "",
      attributionRequired: "false",
      copyrighted: "False",
      nonFree: "",
    };
    expect(matchPhotoLicense({ ...pd, copyrighted: "True" })).toEqual({
      ok: false,
      refusal: "license_mismatch",
    });
    expect(
      matchPhotoLicense({
        ...pd,
        licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/",
      }),
    ).toEqual({ ok: false, refusal: "license_mismatch" });
  });
});
