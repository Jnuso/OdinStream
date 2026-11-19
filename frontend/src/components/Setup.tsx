import { useState, type FormEvent } from "react";
import { api } from "../data/api";

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
  return <main className="page-content"><section className="composer account-form">
    <h1>Set up your account</h1>
    <p>Choose your username and who can see your profile. You can update your preferences later.</p>
    <form onSubmit={submit}>
      <label htmlFor="setup-username">Username (required)</label>
      <input id="setup-username" value={username} onChange={event => setUsername(event.target.value)}
        required minLength={3} maxLength={30} pattern="[A-Za-z0-9_.]{3,30}" autoComplete="username" />
      <p className="muted">3–30 letters, numbers, dots or underscores. Capitalization is displayed as entered; usernames are unique regardless of case.</p>
      <fieldset disabled={busy}><legend>Profile privacy (required)</legend>
        <label><input type="radio" name="visibility" value="public" required checked={visibility === "public"} onChange={() => setVisibility("public")} /> Public — signed-in users can see your posts and follow you.</label>
        <label><input type="radio" name="visibility" value="private" required checked={visibility === "private"} onChange={() => setVisibility("private")} /> Private — approve follow requests before people can see your posts.</label>
      </fieldset>
      <p>These preferences are optional. Leave them blank to skip for now.</p>
      <fieldset disabled={busy}><legend>Favorite movie and TV genres (optional)</legend>
        {genres.map(item => <label className="service-check" key={item}><input type="checkbox" checked={favoriteGenres.includes(item)} onChange={() => toggle(item, favoriteGenres, setFavoriteGenres)} /> {item}</label>)}
      </fieldset>
      <fieldset disabled={busy}><legend>Streaming services (optional)</legend>
        {services.map(item => <label className="service-check" key={item}><input type="checkbox" checked={streamingServices.includes(item)} onChange={() => toggle(item, streamingServices, setStreamingServices)} /> {item}</label>)}
      </fieldset>
      {error && <p role="alert" className="form-error">{error}</p>}
      <button type="submit" className="primary" disabled={busy}>{busy ? "Saving…" : "Finish setup"}</button>
      <button type="button" className="secondary" disabled={busy} onClick={onSignOut}>Sign out</button>
    </form>
  </section></main>;
}
