/**
 * Headers for authenticated internal `$fetch` calls that may run during SSR.
 *
 * During server-side rendering (e.g. a hard page refresh), `$fetch` does NOT automatically
 * forward the incoming request's cookies, so authenticated API routes return 401. This helper
 * forwards the session cookie on the server and is a no-op on the client (where the browser
 * attaches cookies itself). Mirrors the pattern already used in `useSession`.
 *
 * Call it synchronously at the start of a loader (before any `await`) so it runs within the
 * setup/request context on the server.
 */
export function ssrCookieHeaders(): Record<string, string> | undefined {
  return import.meta.server ? useRequestHeaders(['cookie']) : undefined
}
