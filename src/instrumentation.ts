/**
 * Runs once when the web server starts.
 *
 * The firm works in India, so server-rendered dates and times follow Indian time. The container sets
 * TZ too (Dockerfile); this covers a host or env file that says otherwise.
 */
export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") process.env.TZ = "Asia/Kolkata";
}
