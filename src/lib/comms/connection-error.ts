/**
 * Turn the cryptic errors that imapflow / nodemailer surface — "Command failed",
 * "Invalid login", bare error codes — into a clear, actionable message for the
 * mailbox "Test connection" UI, so the user knows what to actually do.
 */
export function describeMailError(e: any, kind: "imap" | "smtp"): string {
  const text = String(e?.responseText ?? e?.response ?? "").trim();
  const serverCode = String(e?.serverResponseCode ?? e?.responseCode ?? "").toUpperCase();
  const netCode = String(e?.code ?? "").toUpperCase();
  const msg = String(e?.message ?? "").trim();
  const blob = `${text} ${serverCode} ${netCode} ${msg}`.toLowerCase();

  // 1. Authentication rejected — the #1 cause of Zoho/Gmail "Command failed".
  const isAuth =
    e?.authenticationFailed === true ||
    serverCode === "AUTHENTICATIONFAILED" ||
    netCode === "EAUTH" ||
    /authenticationfailed|invalid (credentials|login|username|password)|auth(entication)? failed|login failed|\b535\b|\b534\b/.test(blob);
  if (isAuth) {
    return (
      "Authentication failed. Most providers (Zoho, Gmail, Outlook) require an " +
      "app-specific password once 2-factor auth is on — your normal login " +
      "password won't work. Generate an app password, confirm the username is " +
      "the full email address, and make sure " +
      (kind === "imap" ? "IMAP" : "SMTP") +
      " access is enabled in your mailbox settings."
    );
  }

  // 2. DNS — host typo.
  if (netCode === "ENOTFOUND" || netCode === "EAI_AGAIN" || /enotfound|getaddrinfo/.test(blob)) {
    return "Couldn't find that server — double-check the host address.";
  }

  // 3. Reachability / TLS / timeout.
  if (
    ["ECONNREFUSED", "ETIMEDOUT", "ECONNRESET", "EPIPE", "ESOCKET"].includes(netCode) ||
    /timed ?out|timeout|econnrefused|certificate|self.signed|tls|ssl|closedafter/.test(blob)
  ) {
    return (
      "Couldn't reach the server. Check the host and port, and that the SSL/TLS " +
      "toggle matches the port (" +
      (kind === "imap" ? "993 uses SSL" : "465 uses SSL, 587 uses STARTTLS") +
      ")."
    );
  }

  // 4. Fall back to the server's own words if they beat the cryptic defaults.
  if (text && !/^command failed$/i.test(text)) return text;
  if (msg && !/^command failed$/i.test(msg)) return msg;

  // imapflow / nodemailer's bare "Command failed" carries no detail — but for a
  // mailbox test it's almost always a rejected login, so lead with that fix.
  return (
    "The server rejected the connection. This is usually the password — most " +
    "providers (Zoho, Gmail, Outlook) require an app-specific password and need " +
    (kind === "imap" ? "IMAP" : "SMTP") +
    " access enabled in mailbox settings. If the credentials are correct, " +
    "re-check the host, port and SSL/TLS setting."
  );
}
