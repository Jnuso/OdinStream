import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../data/auth";
import { api } from "../data/api";
import Skeleton from "./Skeleton";

type Preferences = { favorite_genres: string[]; streaming_services: string[] };
const preferenceOptions = {
  favorite_genres: ["Action", "Animation", "Comedy", "Documentary", "Drama", "Fantasy", "Horror", "Romance", "Science Fiction", "Thriller"],
  streaming_services: ["Netflix", "Max", "Apple TV+", "Hulu", "Disney+"],
};

function AccountPreferences({ token }: { token: string }) {
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const tokenRef = useRef(token);
  tokenRef.current = token;

  useEffect(() => {
    let active = true;
    setPreferences(null); setError(""); setMessage("");
    api<Preferences>("/api/me/preferences", tokenRef.current)
      .then(data => { if (active) setPreferences(data); })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : "Could not load preferences."); });
    return () => { active = false; };
  }, [reload]);

  function toggle(key: keyof Preferences, value: string) {
    setPreferences(previous => {
      if (!previous) return previous;
      const selected = previous[key];
      return { ...previous, [key]: selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value] };
    });
    setMessage(""); setError("");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!preferences) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const saved = await api<Preferences>("/api/me/preferences", tokenRef.current, { method: "PUT", body: JSON.stringify(preferences) });
      setPreferences(saved); setMessage("Preferences saved.");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save preferences."); }
    finally { setSaving(false); }
  }

  let content;
  if (preferences) content = (
      <form onSubmit={save}>
        {!preferences.favorite_genres.length && !preferences.streaming_services.length && <p>Choose favorites to personalize your account, or leave them empty for now.</p>}
        {([ ["favorite_genres", "Favorite genres"], ["streaming_services", "Streaming services"] ] as const).map(([key, label]) =>
          <fieldset key={key} disabled={saving}><legend>{label}</legend>
            {preferenceOptions[key].map(option => <label className="service-check" key={option}><input type="checkbox" checked={preferences[key].includes(option)} onChange={() => toggle(key, option)} />{option}</label>)}
          </fieldset>)}
        <p className="muted">Availability is limited to the United States.</p>
        <button className="primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save preferences"}</button>
        {message && <p role="status">{message}</p>}
      </form>);
  else content = error
    ? <button className="secondary" onClick={() => setReload(value => value + 1)}>Retry loading preferences</button>
    : <Skeleton label="Loading preferences…" variant="form" />;
  return <section className="account-preferences preferences"><h2>Account preferences</h2>
    {error && <p className="form-error" role="alert">{error}</p>}
    {content}
  </section>;
}

type Mode = "signin" | "signup" | "reset" | "recovery";

function DeleteAccount({ token, onDeleted }: { token: string; onDeleted: () => void }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (confirmation !== "DELETE") return;
    setBusy(true);
    setError("");
    try {
      await api<void>("/api/me", token, {
        method: "DELETE",
        body: JSON.stringify({ password }),
      });
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="account-danger">
      <h2>Delete account</h2>
      <p>This permanently removes your profile, library, posts, and preferences. This cannot be undone.</p>
      <form onSubmit={submit}>
        <label htmlFor="delete-account-password">Current password</label>
        <input
          id="delete-account-password"
          type="password"
          value={password}
          onChange={event => setPassword(event.target.value)}
          required
          autoComplete="current-password"
          disabled={busy}
        />
        <label htmlFor="delete-account-confirmation">Type DELETE to confirm</label>
        <input
          id="delete-account-confirmation"
          value={confirmation}
          onChange={event => setConfirmation(event.target.value)}
          required
          pattern="DELETE"
          disabled={busy}
        />
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="danger" type="submit" disabled={busy || confirmation !== "DELETE"}>
          {busy ? "Deleting account…" : "Permanently delete account"}
        </button>
      </form>
    </section>
  );
}

export default function Account({ session, recovery, callbackError, onClearCallbackError, onRecoveryComplete, onDeleted }: {
  session: Session | null; recovery: boolean; callbackError: string | null;
  onClearCallbackError: () => void; onRecoveryComplete: () => void; onDeleted: () => void;
}) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (recovery) setMode("recovery"); }, [recovery]);
  if (!supabase) return <p>Account access is not configured. Set the public Supabase URL and publishable key for the frontend.</p>;
  const client = supabase;

  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setMessage(""); onClearCallbackError(); setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setMessage("Signed in.");
      } else if (mode === "signup") {
        const { error } = await client.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin + "/" } });
        if (error) throw error;
        setMessage("If registration is available for this address, check your email for a confirmation link.");
      } else if (mode === "reset") {
        const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + "/" });
        if (error) throw error;
        setMessage("If the account exists, check your email for a password reset link.");
      } else {
        const { error } = await client.auth.updateUser({ password });
        if (error) throw error;
        setMessage("Password updated."); setMode("signin"); onRecoveryComplete();
      }
      setPassword("");
    } catch (err) { setError(err instanceof Error ? err.message : "Account request failed."); }
    finally { setBusy(false); }
  }

  async function resend() {
    setBusy(true); setError(""); setMessage(""); onClearCallbackError();
    try {
      const { error } = await client.auth.resend({ type: "signup", email, options: { emailRedirectTo: window.location.origin + "/" } });
      if (error) throw error;
      setMessage("If confirmation is pending, check your email for a new link.");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not resend confirmation."); }
    finally { setBusy(false); }
  }

  if (session && mode !== "recovery") return <section className="account-page"><div className="page-heading"><div><h1>Account</h1><p>Your preferences and sign-in details, all in one place.</p></div></div>{callbackError && <p className="form-error" role="alert">{callbackError}</p>}<div className="account-summary"><div><h2>Signed in</h2><p>{session.user.email}</p></div><button className="secondary" onClick={async () => {
    const { error } = await client.auth.signOut();
    if (error) setError(error.message);
  }}>Sign out</button></div>{error && <p className="form-error" role="alert">{error}</p>}<AccountPreferences key={session.user.id} token={session.access_token} /><DeleteAccount token={session.access_token} onDeleted={onDeleted} /></section>;

  return <section className="account-page account-auth"><span className="eyebrow">Your next watch starts here</span><h1>{mode === "signup" ? "Create account" : mode === "reset" ? "Reset password" : mode === "recovery" ? "Choose a new password" : "Welcome back"}</h1><p className="muted">{mode === "signup" ? "Save your favorites and share what’s worth watching." : mode === "signin" ? "Sign in to your library, reviews, and recommendations." : "Let’s get you back into your account."}</p>
    <form className="composer account-form" onSubmit={submit}>
      {mode !== "recovery" && <><label htmlFor="account-email">Email</label><input id="account-email" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" /></>}
      {mode !== "reset" && <><label htmlFor="account-password">Password</label><input id="account-password" type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={mode === "signin" ? 1 : 8} autoComplete={mode === "signin" ? "current-password" : "new-password"} /></>}
      {(error || callbackError) && <p className="form-error" role="alert">{error || callbackError}</p>}{message && <p role="status">{message}</p>}
      <button className="primary" disabled={busy} type="submit">{mode === "signup" ? "Create account" : mode === "reset" ? "Send reset link" : mode === "recovery" ? "Update password" : "Sign in"}</button>
    </form>
    {mode !== "recovery" && <div className="account-actions">
      <button className="secondary" onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setError(""); setMessage(""); }}>{mode === "signup" ? "Sign in" : "Create account"}</button>
      <button className="secondary" onClick={() => { setMode(mode === "reset" ? "signin" : "reset"); setError(""); setMessage(""); }}>{mode === "reset" ? "Back to sign in" : "Forgot password?"}</button>
      <button className="secondary" disabled={!email || busy} onClick={resend}>Resend confirmation</button>
    </div>}
  </section>;
}
