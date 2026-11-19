import { useState, type FormEvent } from "react";
import { api } from "../data/api";
import AccountLayout from "./AccountLayout";

const genres = ["Action", "Animation", "Comedy", "Documentary", "Drama", "Fantasy", "Horror", "Romance", "Science Fiction", "Thriller"];
const services = ["Netflix", "Max", "Apple TV+", "Hulu", "Disney+"];

type Visibility = "public" | "private" | "";

export default function Setup({ token, onComplete, onSignOut }: {
  token: string; onComplete: () => void; onSignOut: () => void;
}) {
  const [username, setUsername] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("");
  const [favoriteGenres, setFavoriteGenres] = useState<string[]>([]);
  const [streamingServices, setStreamingServices] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function toggle(value: string, selected: string[], update: (values: string[]) => void) {
    update(selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value]);
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await api("/api/me/setup", token, { method: "PUT", body: JSON.stringify({ username: username.trim(), visibility,
        favorite_genres: favoriteGenres, streaming_services: streamingServices }) });
      onComplete();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not complete setup."); }
    finally { setBusy(false); }
  }
  return <AccountLayout>
    <header className="setup-heading">
      <h1>Set up your account</h1>
      <p>Choose your username and who can see your profile. Make it yours with a few favorites.</p>
    </header>
    <form className="setup-form" onSubmit={submit} aria-busy={busy}>
      <div className="setup-field">
        <label htmlFor="setup-username">Username <span className="setup-annotation">(required)</span></label>
        <input id="setup-username" value={username} onChange={event => setUsername(event.target.value)}
          disabled={busy} required minLength={3} maxLength={30} pattern="[A-Za-z0-9_.]{3,30}"
          autoComplete="username" autoCapitalize="none" spellCheck={false} aria-describedby="setup-username-hint" />
        <p className="setup-hint" id="setup-username-hint">Use 3–30 letters, numbers, dots or underscores. Capitalization is kept, but usernames are unique regardless of case.</p>
      </div>
      <fieldset disabled={busy}><legend>Profile privacy <span className="setup-annotation">(required)</span></legend>
        <div className="setup-privacy-options">
          <label className="setup-privacy-option">
            <input type="radio" name="visibility" value="public" required checked={visibility === "public"} onChange={() => setVisibility("public")} />
            <span><strong>Public</strong><small>Signed-in users can see your posts and follow you.</small></span>
          </label>
          <label className="setup-privacy-option">
            <input type="radio" name="visibility" value="private" required checked={visibility === "private"} onChange={() => setVisibility("private")} />
            <span><strong>Private</strong><small>Approve follow requests before people can see your posts.</small></span>
          </label>
        </div>
      </fieldset>
      <section className="setup-preferences" aria-labelledby="setup-preferences-heading">
        <div><h2 id="setup-preferences-heading">Your preferences</h2>
          <p className="setup-hint">Optional. Pick a few favorites, or skip these for now. You can change them later.</p></div>
        <fieldset disabled={busy}><legend>Favorite movie and TV genres <span className="setup-annotation">(optional)</span></legend>
          <div className="setup-choices">{genres.map(item => <label className="setup-choice" key={item}><input type="checkbox" checked={favoriteGenres.includes(item)} onChange={() => toggle(item, favoriteGenres, setFavoriteGenres)} />{item}</label>)}</div>
        </fieldset>
        <fieldset disabled={busy}><legend>Streaming services <span className="setup-annotation">(optional)</span></legend>
          <div className="setup-choices">{services.map(item => <label className="setup-choice" key={item}><input type="checkbox" checked={streamingServices.includes(item)} onChange={() => toggle(item, streamingServices, setStreamingServices)} />{item}</label>)}</div>
        </fieldset>
      </section>
      {error && <p role="alert" className="form-error">{error}</p>}
      <div className="setup-actions">
        <button type="submit" className="primary" disabled={busy}>{busy ? "Saving…" : "Finish setup"}</button>
        <button type="button" className="secondary" disabled={busy} onClick={onSignOut}>Sign out</button>
      </div>
    </form>
  </AccountLayout>;
}
