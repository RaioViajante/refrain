// Log-safe reporting for the authentication library.
//
// Better Auth logs whole error objects by default. A failed Drizzle query
// carries its SQL parameters in the error message, and for authentication
// queries those parameters are session tokens and password hashes. Everything
// Better Auth logs therefore passes through here, and only fixed text, error
// names, HTTP statuses, and error codes are written (docs/security.md §
// Logging).

type LogLevel = "debug" | "info" | "success" | "warn" | "error";

const MAX_MESSAGE_LENGTH = 160;

/** Name, status, and code of an error, found through its `cause` chain. */
export function describeAuthError(error: unknown): Record<string, string> {
  const description: Record<string, string> = {};
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth++) {
    if (typeof current !== "object" || current === null) {
      break;
    }
    const record = current as Record<string, unknown>;
    if (depth === 0 && typeof record.name === "string") {
      description.name = record.name;
    }
    if (description.status === undefined && typeof record.status === "string") {
      description.status = record.status;
    }
    // The first string code found: an API error code, a PostgreSQL SQLSTATE,
    // or a Node.js network code such as ECONNREFUSED.
    if (description.code === undefined && typeof record.code === "string") {
      description.code = record.code;
    }
    current = record.cause;
  }
  return description;
}

/**
 * Keeps the first line of a library message, without anything after
 * "params", and shortened. A Drizzle query message has the form
 * "Failed query: <sql>\nparams: <values>".
 */
export function redactLogMessage(message: unknown): string {
  if (typeof message !== "string") {
    return "";
  }
  const [firstLine = ""] = message.split(/\r?\n/, 1);
  const withoutParams = firstLine.split(/params:/i, 1)[0] ?? "";
  return withoutParams.length > MAX_MESSAGE_LENGTH
    ? `${withoutParams.slice(0, MAX_MESSAGE_LENGTH)}…`
    : withoutParams;
}

/** Better Auth's `logger.log`: writes redacted entries only. */
export function logAuthMessage(
  level: LogLevel,
  message: string,
  ...args: unknown[]
): void {
  const entry = {
    message: redactLogMessage(message),
    errors: args
      .filter((arg) => typeof arg === "object" && arg !== null)
      .map(describeAuthError),
  };
  if (level === "error") {
    console.error("Authentication", entry);
  } else if (level === "warn") {
    console.warn("Authentication", entry);
  } else {
    console.info("Authentication", entry);
  }
}

/** Better Auth's `onAPIError.onError`: logs the error's shape, never its message. */
export function logAuthApiError(error: unknown): void {
  console.error("Authentication request failed", describeAuthError(error));
}
