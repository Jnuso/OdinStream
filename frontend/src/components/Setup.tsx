import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "../data/api";
import AccountLayout from "./AccountLayout";
import FavoritesPicker from "./FavoritesPicker";
import { favoriteKey, type Favorite } from "../data/favorites";
import { preferenceOptions } from "../data/preferencesCache";

type Visibility = "public" | "private" | "";

export default function Setup({ token, onComplete, onSignOut }: {
  token: string; onComplete: () => void; onSignOut: () => void;
}) {
  const [username, setUsername] = useState("");
  const [step, setStep] = useState<1 | 2>(1);
  const heading = useRef<HTMLHeadingElement>(null);
  const [visibility, setVisibility] = useState<Visibility>("");
  const [favoriteGenres, setFavoriteGenres] = useState<string[]>([]);
  const [streamingServices, setStreamingServices] = useState<string[]>([]);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  function toggle(value: string, selected: string[], update: (values: string[]) => void) {
    update(selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value]);
  }
  async function finish(skip: boolean) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/me/setup", token, { method: "PUT", body: JSON.stringify({ username: username.trim(), visibility,
        favorite_genres: skip ? [] : favoriteGenres,
        streaming_services: skip ? [] : streamingServices,
        favorite_titles: skip ? [] : favorites.flatMap(({ media_type, id }) => media_type ? [{ media_type, id }] : []),
        favorite_people: skip ? [] : favorites.filter(item => !item.media_type).map(item => item.id),
      }) });
      onComplete();
    } catch (err) {
      if (err instanceof ApiError && err.code === "setup_already_complete") {
        onComplete();
        return;
      }
      // A lost response can leave a successful setup committed on the server.
      if (!(err instanceof ApiError)) {
        const status = await api<{ setup_complete: boolean }>("/api/me/setup", token).catch(() => null);
        if (status?.setup_complete) {
          onComplete();
          return;
        }
      }
      if (err instanceof ApiError && (err.code === "duplicate_handle" || err.code === "invalid_username")) setStep(1);
      setError(err instanceof Error ? err.message : "Could not complete setup.");
    }
    finally { setBusy(false); }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (step === 1) {
      setError("");
      setStep(2);
    } else {
      void finish(false);
    }
  }

  return <AccountLayout>
    <header className="setup-heading">
      <p className="setup-progress">Step {step} of 2</p>
      <h1 ref={heading} tabIndex={-1}>{step === 1 ? "Set up your profile" : "Personalize your recommendations"}</h1>
      <p>{step === 1 ? "Choose your username and who can see your profile."
        : "What do you love watching? Start with three favorites, add more if you like, or skip for now."}</p>
    </header>
    <form className="setup-form" onSubmit={submit} aria-busy={busy}>
      {step === 1 ? <>
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
      </> : <>
      <FavoritesPicker selected={favorites} disabled={busy}
        onAdd={item => setFavorites(previous => previous.some(pick => favoriteKey(pick) === favoriteKey(item)) ? previous : [...previous, item])}
        onRemove={item => setFavorites(previous => previous.filter(pick => favoriteKey(pick) !== favoriteKey(item)))} />
      <section className="setup-preferences" aria-labelledby="setup-preferences-heading">
        <div><h2 id="setup-preferences-heading">Your preferences</h2>
          <p className="setup-hint">Optional. Pick a few favorites, or skip these for now. You can change them later.</p></div>
        <fieldset disabled={busy}><legend>Favorite movie and TV genres <span className="setup-annotation">(optional)</span></legend>
          <div className="setup-choices">{preferenceOptions.favorite_genres.map(item => <label className="setup-choice" key={item}><input type="checkbox" checked={favoriteGenres.includes(item)} onChange={() => toggle(item, favoriteGenres, setFavoriteGenres)} />{item}</label>)}</div>
        </fieldset>
        <fieldset disabled={busy}><legend>Streaming services <span className="setup-annotation">(optional)</span></legend>
          <p className="setup-hint">Choose the services you use to filter Discover by US streaming availability.</p>
          <div className="setup-choices">{preferenceOptions.streaming_services.map(item => <label className="setup-choice" key={item}><input type="checkbox" checked={streamingServices.includes(item)} onChange={() => toggle(item, streamingServices, setStreamingServices)} />{item}</label>)}</div>
        </fieldset>
      </section>
      </>}
      {error && <p role="alert" className="form-error">{error}</p>}
      <div className="setup-actions">
        {step === 1 ? <>
          <button type="submit" className="primary">Continue</button>
          <button type="button" className="secondary" onClick={onSignOut}>Sign out</button>
        </> : <>
          <button type="submit" className="primary" disabled={busy}>{busy ? "Saving…" : "Finish setup"}</button>
          <button type="button" className="secondary" disabled={busy} onClick={() => void finish(true)}>Skip for now</button>
          <button type="button" className="secondary" disabled={busy} onClick={() => { setError(""); setStep(1); }}>Back</button>
        </>}
      </div>
    </form>
  </AccountLayout>;
}
