import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getStudioSession } from "@/server/auth/studio";

import "../studio.css";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "entrar",
  robots: { index: false, follow: false },
};

// The sign-in page is the only Studio page without a session check; a
// signed-in owner is sent to the dashboard.
export default async function SignInPage() {
  if (await getStudioSession()) redirect("/studio");
  return (
    <main id="conteudo">
      <h1>studio</h1>
      <LoginForm />
    </main>
  );
}
