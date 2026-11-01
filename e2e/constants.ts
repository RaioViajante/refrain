// Shared by playwright.config.ts and the tests, so the tests never import the
// configuration itself.

// A fixed, unusual port: predictable for the application's origin check
// (BETTER_AUTH_URL must equal the browser's origin), and away from the
// development server's 3000. The setup refuses to start if it is taken, so
// the tests can never end up talking to a server they did not start.
export const PORT = Number(process.env.E2E_PORT ?? 3410);
export const BASE_URL = `http://127.0.0.1:${PORT}`;

// The signed-in session of the synthetic author. Ignored by Git: it belongs
// to the disposable server of one run.
export const AUTH_FILE = "playwright/.auth/author.json";

// The visual review package runs only when this is exactly "1"
// (`pnpm review:screens`); any other value, including "0", leaves it off.
export const VISUAL_REVIEW = process.env.VISUAL_REVIEW === "1";
