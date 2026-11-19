import type { ReactNode } from "react";
import "./AccountLayout.css";

export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <main className="onboarding-page">
      <div className="onboarding-content">
        <div className="onboarding-brand">Odin<span>Stream</span></div>
        <section className="onboarding-panel">{children}</section>
      </div>
    </main>
  );
}

export function AccountStatus({ error = false, onRetry, onSignOut }: {
  error?: boolean;
  onRetry?: () => void;
  onSignOut?: () => void;
}) {
  return (
    <AccountLayout>
      <div className="account-status" role={error ? "alert" : "status"}>
        <span className={`account-status-indicator${error ? " is-error" : ""}`} aria-hidden="true">
          {error ? "!" : ""}
        </span>
        <h1>{error ? "We couldn’t open your account" : "Getting your account ready"}</h1>
        <p>{error ? "Your account details couldn’t load. Please try again." : "One moment while we check your account details."}</p>
      </div>
      {error && <div className="setup-actions">
        <button className="primary" onClick={onRetry}>Try again</button>
        <button className="secondary" onClick={onSignOut}>Sign out</button>
      </div>}
    </AccountLayout>
  );
}
