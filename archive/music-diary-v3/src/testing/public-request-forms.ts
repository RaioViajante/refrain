// The request forms and path variants of one public address, shared by the
// HTTP tests that compare a hidden address with an unknown one
// (public-request-forms.http.test.ts, public-cache-indicator.http.test.ts).
import { comparable, type Snapshot } from "@/testing/public-http";

// What a response says about the request itself and nothing about any journal:
// the slug it was asked for, which a redirect repeats in its `Location`,
// `Refresh`, and body, and the random key that the framework puts in the Flight
// data of a page it renders for a crawler. Both are masked before two answers
// are compared.
export function masked(snapshot: Snapshot, slugs: string[]) {
  const mask = (text: string) =>
    slugs
      .reduce((out, slug) => out.split(slug).join("SLUG"), text)
      .replace(/(")[A-Za-z0-9_-]{21,23}(?![A-Za-z0-9_-])/g, "$1ID");
  const view = comparable(snapshot);
  return {
    status: view.status,
    headers: Object.fromEntries(
      Object.entries(view.headers).map(([name, value]) => [name, mask(value)]),
    ),
    body: mask(view.body),
  };
}

// Every transport form of one public address.
export function forms(
  s: string,
  buildId: string,
): [string, string, Record<string, string>][] {
  return [
    [
      "router prefetch",
      `/albums/${s}?_rsc=probe`,
      { rsc: "1", "next-router-prefetch": "1" },
    ],
    [
      "segment prefetch (tree)",
      `/albums/${s}?_rsc=probe`,
      {
        rsc: "1",
        "next-router-prefetch": "1",
        "next-router-segment-prefetch": "/_tree",
      },
    ],
    [
      "segment prefetch (page)",
      `/albums/${s}?_rsc=probe`,
      {
        rsc: "1",
        "next-router-prefetch": "1",
        "next-router-segment-prefetch": "/albums/[slug]/__PAGE__",
      },
    ],
    ["segment file", `/albums/${s}.segments/_tree.segment.rsc`, {}],
    [
      "page segment file",
      `/albums/${s}.segments/albums/$d$slug/__PAGE__.segment.rsc`,
      {},
    ],
    [".rsc", `/albums/${s}.rsc`, {}],
    [".json", `/albums/${s}.json`, {}],
    ["next data", `/_next/data/${buildId}/albums/${s}.json`, {}],
    [
      "Accept: application/json",
      `/albums/${s}`,
      { accept: "application/json" },
    ],
    ["Accept: text/plain", `/albums/${s}`, { accept: "text/plain" }],
    ["If-None-Match: *", `/albums/${s}`, { "if-none-match": "*" }],
    ["If-None-Match: a validator", `/albums/${s}`, { "if-none-match": '"x"' }],
    [
      "If-Modified-Since",
      `/albums/${s}`,
      { "if-modified-since": "Wed, 21 Oct 2037 07:28:00 GMT" },
    ],
    ["Range", `/albums/${s}`, { range: "bytes=0-10" }],
  ];
}

export const variants = (s: string): [string, string][] => [
  ["uppercase path", `/ALBUMS/${s}`],
  ["capitalized path", `/Albums/${s}`],
  ["double slash before", `//albums/${s}`],
  ["double slash inside", `/albums//${s}`],
  ["dot segment", `/albums/./${s}`],
  ["encoded slash", `/albums%2F${s}`],
  ["encoded dot", `/albums/%2e/${s}`],
  ["semicolon", `/albums/${s};x=1`],
  ["fragment-like", `/albums/${s}%23x`],
];
