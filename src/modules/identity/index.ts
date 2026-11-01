// Identity and Access module: public entry point. Server-only.
//
// Account provisioning and password reset are deliberately not exported:
// only the local command (./cli.ts) uses them, never the application.
export {
  authorizeAuthor,
  AuthorizationError,
  hasTrustedOrigin,
  requireAuthor,
  type AuthorizationFailure,
  type AuthorizationResult,
  type AuthorizedAuthor,
} from "./authorization";
// Confirmation tokens (ADR 0006 § 3). Signing is for the Publication module's
// two preview operations only (a static test enforces it); verification and
// the validity check are for the consuming commands. The key derivation and
// the explicit-secret variants stay inside the module.
export {
  CONFIRMATION_VALIDITY_MS,
  confirmationAvailable,
  confirmationIsCurrent,
  MAX_CONFIRMATION_TOKEN_LENGTH,
  signConfirmation,
  verifyConfirmation,
  type ConfirmationBinding,
  type ConfirmationIssue,
  type ConfirmationPurpose,
  type SignResult,
  type VerifiedConfirmation,
  type VerifyResult,
} from "./confirmation";
export { handleAuthRequest } from "./handler";
