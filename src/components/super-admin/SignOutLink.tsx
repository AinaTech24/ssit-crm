"use client";

export function SignOutLink() {
  return (
    <button
      onClick={() =>
        fetch("/api/auth/logout?scope=admin", { method: "POST" }).then(() => (window.location.href = "/login"))
      }
      className="text-xs text-muted-foreground hover:underline"
    >
      Sign out
    </button>
  );
}
