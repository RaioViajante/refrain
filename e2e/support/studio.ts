import { expect, type Page } from "@playwright/test";

import { TEST_STUDIO_EMAIL, TEST_STUDIO_PASSWORD } from "./env";

/** Every Studio page and preview, for the authorization checks. */
export const STUDIO_ROUTES = [
  "/studio",
  "/studio/mixtapes",
  "/studio/mixtapes/nova",
  // A well-formed id: the redirect must come before any lookup.
  "/studio/mixtapes/00000000-0000-4000-8000-000000000000",
  "/studio/musicas",
  "/studio/textos",
  "/studio/fotos",
  "/studio/previa/home",
  "/studio/previa/sobre",
  "/studio/previa/mixtapes/00000000-0000-4000-8000-000000000000",
] as const;

/** Signs in with the [Test] credentials and waits for the dashboard. */
export async function signIn(page: Page) {
  await page.goto("/studio/entrar");
  await page.getByLabel("e-mail").fill(TEST_STUDIO_EMAIL);
  await page.getByLabel("senha", { exact: true }).fill(TEST_STUDIO_PASSWORD);
  await page.getByRole("button", { name: "entrar" }).click();
  await expect(page).toHaveURL(/\/studio$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("painel");
}

/** A short suffix that keeps titles unique across tests, projects, and runs. */
export function unique(): string {
  return `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;
}

/** Creates a draft tape from /studio/mixtapes/nova; returns its editor id. */
export async function createTape(page: Page, title: string): Promise<string> {
  await page.goto("/studio/mixtapes/nova");
  await page.getByLabel("título", { exact: true }).fill(title);
  await page.getByRole("button", { name: "criar fita" }).click();
  await expect(page).toHaveURL(/\/studio\/mixtapes\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  return page.url().split("/").pop()!;
}
