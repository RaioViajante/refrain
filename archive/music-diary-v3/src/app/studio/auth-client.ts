"use client";

import { createAuthClient } from "better-auth/client";

// Browser client for the Better Auth endpoints on this origin. It holds no
// secret and grants nothing: every studio page and action authorizes the
// request on the server (src/modules/identity).
export const authClient = createAuthClient();
