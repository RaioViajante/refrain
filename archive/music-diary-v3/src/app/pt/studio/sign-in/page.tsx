import { SignInScreen, signInMetadata } from "@/app/studio/sign-in/screen";

export default function Page() {
  return <SignInScreen locale="pt-BR" />;
}

export const metadata = signInMetadata("pt-BR");
