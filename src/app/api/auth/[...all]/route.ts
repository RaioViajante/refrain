// Better Auth's endpoints. The handler passes only an allow-list of them to
// the library and answers everything else with 404 (src/modules/identity).
import { handleAuthRequest } from "@/modules/identity";

export const GET = handleAuthRequest;
export const POST = handleAuthRequest;
