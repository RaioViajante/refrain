// Identity and Access module: public entry point. Server-only.
//
// Account provisioning and password reset are deliberately not exported:
// only the local command (./cli.ts) uses them, never the application.
export {
  authorizeAuthor,
  AuthorizationError,
  requireAuthor,
  type AuthorizationFailure,
  type AuthorizationResult,
  type AuthorizedAuthor,
} from "./authorization";
export { handleAuthRequest } from "./handler";
