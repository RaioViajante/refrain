// Prints the STUDIO_PASSWORD_HASH for a password typed on the terminal
// (not echoed, never written to disk or shell history).
//   pnpm studio:hash
import { stdin, stdout } from "node:process";

import { hashPassword } from "../src/server/auth/password.ts";

async function readHidden(prompt: string): Promise<string> {
  stdout.write(prompt);
  stdin.setRawMode?.(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  let value = "";
  return new Promise((resolve) => {
    stdin.on("data", (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdout.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u0003") process.exit(130);
        if (ch === "\u007f") value = value.slice(0, -1);
        else value += ch;
      }
    });
  });
}

const password = await readHidden("senha do studio: ");
if (password.length < 12) {
  console.error("use pelo menos 12 caracteres.");
  process.exit(1);
}
const again = await readHidden("repita a senha: ");
if (again !== password) {
  console.error("as senhas não conferem.");
  process.exit(1);
}
console.log(await hashPassword(password));
