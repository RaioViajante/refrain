// Sets the Studio owner's sign-in on the hosted project, without the email,
// password, or hash ever being printed, logged, or written to disk: the
// password is read without echo, hashed here, and the values are piped into
// `vercel env add … --sensitive` (stored as secrets, unreadable afterwards).
//
//   pnpm studio:credentials            # Preview environment
//   pnpm studio:credentials production # Production (only when authorized)
//
// Refuses to run unless this checkout is linked to the "refrain-mixtapes"
// Vercel project (never the archived music diary's "refrain").
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

import { hashPassword } from "../src/server/auth/password.ts";

const PROJECT = "refrain-mixtapes";
const target = process.argv[2] ?? "preview";
if (target !== "preview" && target !== "production") {
  console.error("use: pnpm studio:credentials [preview|production]");
  process.exit(1);
}

let linked = "";
try {
  linked = JSON.parse(readFileSync(".vercel/project.json", "utf8")).projectName;
} catch {
  // handled below
}
if (linked !== PROJECT) {
  console.error(
    `refused: this checkout is not linked to "${PROJECT}" (run: vercel link --project ${PROJECT}).`,
  );
  process.exit(1);
}

async function readHidden(prompt: string): Promise<string> {
  stdout.write(prompt);
  stdin.setRawMode?.(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  let value = "";
  return new Promise((resolve) => {
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.off("data", onData);
          stdout.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u0003") process.exit(130);
        if (ch === "\u007f") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

const rl = createInterface({ input: stdin, output: stdout });
const email = (await rl.question("e-mail do studio: ")).trim().toLowerCase();
rl.close();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("e-mail inválido.");
  process.exit(1);
}
const password = await readHidden("senha (12+ caracteres, não aparece): ");
if (password.length < 12) {
  console.error("use pelo menos 12 caracteres.");
  process.exit(1);
}
if ((await readHidden("repita a senha: ")) !== password) {
  console.error("as senhas não conferem.");
  process.exit(1);
}

const hash = await hashPassword(password);
for (const [name, value] of [
  ["STUDIO_EMAIL", email],
  ["STUDIO_PASSWORD_HASH", hash],
] as const) {
  const result = spawnSync(
    "vercel",
    ["env", "add", name, target, "--sensitive", "--force", "--yes"],
    { input: value, stdio: ["pipe", "ignore", "pipe"], encoding: "utf8" },
  );
  if (result.status !== 0) {
    console.error(
      `failed to set ${name}: ${result.stderr.split("\n").find(Boolean) ?? "unknown error"}`,
    );
    process.exit(1);
  }
  console.log(`${name}: set for ${target}.`);
}
console.log("done. a new deployment is needed for the change to take effect.");
