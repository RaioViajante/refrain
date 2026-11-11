import { SignInScreen, signInMetadata } from "@/app/studio/sign-in/screen";

export default function Page() {
  return <SignInScreen locale="en" />;
}

export const metadata = signInMetadata("en");
