import { redirect } from "next/navigation";
import type { ReactElement } from "react";

import type { AuthorizationFailure } from "@/modules/identity";

/**
 * What a studio page shows when `authorizeAuthor` did not authorize the
 * request: a redirect to sign-in, or, when the session cannot be checked at
 * all, a plain notice. Called only after the page itself has asked Identity.
 */
export function accessDenied(reason: AuthorizationFailure): ReactElement {
  if (reason === "unavailable") {
    return (
      <main className="studio-main">
        <h1 className="studio-title">Writing studio</h1>
        <p className="text-[19px]">
          The studio isn’t available right now. Try again later.
        </p>
      </main>
    );
  }
  return redirect("/studio/sign-in");
}
