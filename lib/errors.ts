// Server-side error hygiene.
//
// The rule, applied to every server action: DETAIL goes to the server log,
// GENERIC goes to the client. A client must never receive a stack trace, a SQL
// string, a driver message, a column or table name, or anything else that
// describes the shape of the server — those are reconnaissance for an attacker
// and noise for a user who can only act on "that didn't work, try again".
//
// Structured VALIDATION errors are the deliberate exception: those describe the
// caller's OWN input ("Enter a valid email address"), reveal nothing about the
// server, and are the whole point of field-level feedback.

import "server-only";

/**
 * Log a caught error with enough context to debug it, and return nothing the
 * caller can leak. Pair it with a generic typed result:
 *
 *   } catch (err) {
 *     logServerError("postFeeTransactionAction", err, { studentId });
 *     return { ok: false, error: "unknown" };
 *   }
 *
 * `context` is for your own identifiers (which action, which row). Never put
 * secrets, passwords, or tokens in it — this goes to the server log.
 */
export function logServerError(
  scope: string,
  err: unknown,
  context?: Record<string, string | number | boolean | null | undefined>,
): void {
  const detail =
    err instanceof Error
      ? { name: err.name, message: err.message, stack: err.stack }
      : { name: "NonError", message: String(err) };

  console.error(
    `[${scope}] ${detail.name}: ${detail.message}`,
    context ? { context } : "",
    detail.stack ? `\n${detail.stack}` : "",
  );
}
