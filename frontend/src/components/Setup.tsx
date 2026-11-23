import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "../data/api";
import AccountLayout from "./AccountLayout";
import FavoritesPicker from "./FavoritesPicker";
import StreamingServicePicker from "./StreamingServicePicker";
import { favoriteKey, type Favorite } from "../data/favorites";
import { preferenceOptions } from "../data/preferencesCache";

type Visibility = "public" | "private" | "";

const setupSteps = [
  { title: "Set up your profile", description: "Choose your username and who can see your profile." },
  { title: "Your streaming services", description: "Select the services you use to filter Discover by US streaming availability." },
  { title: "Your favorite genres", description: "Pick the genres you want to see more of in your recommendations." },
  { title: "Your favorite movies and shows", description: "Try adding three favorites to start. You can keep adding more." },
  { title: "Your favorite actors and directors", description: "Pick people whose work you want to see more of. Try starting with three." },
];

export default function Setup({ token, onComplete, onSignOut }: {
  token: string; onComplete: () => void; onSignOut: () => void;
}) {
  const [username, setUsername] = useState("");
  const [step, setStep] = useState(1);
  const heading = useRef<HTMLHeadingElement>(null);
  const [visibility, setVisibility] = useState<Visibility>("");
  const [favoriteGenres, setFavoriteGenres] = useState<string[]>([]);
  const [streamingServices, setStreamingServices] = useState<string[]>([]);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isLastStep = step === setupSteps.length;

  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  function toggle(value: string, selected: string[], update: (values: string[]) => void) {
    update(selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value]);
  }
  async function finish(skipPeople: boolean) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/me/setup", token, { method: "PUT", body: JSON.stringify({ username: username.trim(), visibility,
        favorite_genres: favoriteGenres,
        streaming_services: streamingServices,
        favorite_titles: favorites.flatMap(({ media_type, id }) => media_type ? [{ media_type, id }] : []),
        favorite_people: skipPeople ? [] : favorites.filter(item => !item.media_type).map(item => item.id),
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
    if (isLastStep) {
      void finish(false);
    } else {
      move(1);
    }
  }

  function move(direction: -1 | 1) {
    setError("");
    setStep(step + direction);
  }

  function skipStep() {
    if (isLastStep) {
      void finish(true);
      return;
    }
    if (step === 2) setStreamingServices([]);
    if (step === 3) setFavoriteGenres([]);
    if (step === 4) setFavorites(previous => previous.filter(item => !item.media_type));
    move(1);
  }

  return <AccountLayout>
    <header className="setup-heading">
      <p className="setup-progress">Step {step} of {setupSteps.length}</p>
      <h1 ref={heading} tabIndex={-1}>{setupSteps[step - 1].title}</h1>
      <p>{setupSteps[step - 1].description}</p>
    </header>
    <form className="setup-form" onSubmit={submit} aria-busy={busy}>
      {step === 1 && <>
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
      </>}
      {(step === 4 || step === 5) && <FavoritesPicker key={step} scope={step === 4 ? "titles" : "people"}
        selected={favorites.filter(item => Boolean(item.media_type) === (step === 4))} disabled={busy}
        onAdd={item => setFavorites(previous => previous.some(pick => favoriteKey(pick) === favoriteKey(item)) ? previous : [...previous, item])}
        onRemove={item => setFavorites(previous => previous.filter(pick => favoriteKey(pick) !== favoriteKey(item)))} />}
      {step === 2 && <fieldset aria-label="Streaming services" disabled={busy}>
        <StreamingServicePicker setup selected={streamingServices}
          onToggle={name => toggle(name, streamingServices, setStreamingServices)} />
      </fieldset>}
      {step === 3 && <fieldset aria-label="Favorite genres">
        <div className="setup-choices">{preferenceOptions.favorite_genres.map(item => <label className="setup-choice" key={item}>
          <input type="checkbox" checked={favoriteGenres.includes(item)} onChange={() => toggle(item, favoriteGenres, setFavoriteGenres)} />{item}
        </label>)}</div>
      </fieldset>}
      {error && <p role="alert" className="form-error">{error}</p>}
      <div className="setup-actions">
        <button type="submit" className="primary" disabled={busy}>{busy ? "Saving…" : isLastStep ? "Finish setup" : "Continue"}</button>
        {step === 1 ? <button type="button" className="secondary" onClick={onSignOut}>Sign out</button> : <>
          <button type="button" className="secondary" disabled={busy} onClick={skipStep}>Skip for now</button>
          <button type="button" className="secondary" disabled={busy} onClick={() => move(-1)}>Back</button>
        </>}
      </div>
    </form>
  </AccountLayout>;
}
