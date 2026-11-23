import { useEffect, useState } from "react";
import { api } from "../data/api";
import { formatYear, initials, type MediaType, type TitleSummary } from "../data/social";
import Modal from "./Modal";
import Poster from "./Poster";
import Skeleton from "./Skeleton";

type Credit = TitleSummary & { characters: string[]; popularity?: number };
export type Actor = { id: number; name: string; profile_path?: string | null; characters?: string[] };
export type CreditRole = "acting" | "creator" | "director";
const creditLabels = {
  acting: { credits: "acting credits", back: "cast" },
  creator: { credits: "creator credits", back: "creators" },
  director: { credits: "directing credits", back: "directors" },
};
type Profile = Actor & { biography: string | null; birthday: string | null; deathday: string | null; place_of_birth: string | null };
const PAGE_SIZE = 12;

function ageOn(birthday: string | null, deathday: string | null) {
  if (!birthday || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return null;
  const end = deathday ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end) || end < birthday) return null;
  return Number(end.slice(0, 4)) - Number(birthday.slice(0, 4)) - Number(end.slice(5) < birthday.slice(5));
}

export function ActorPortrait({ actor, size = "w342" }: { actor: Actor; size?: "w185" | "w342" }) {
  return <span className="title-cast-photo" aria-hidden="true">
    {initials(actor.name)}
    {actor.profile_path && <img key={actor.profile_path} src={`https://image.tmdb.org/t/p/${size}${actor.profile_path}`}
      alt="" loading="lazy" onError={event => { event.currentTarget.hidden = true; }} />}
  </span>;
}

export default function ActorCredits({ actor, role = "acting", currentTitle, token, onFavoriteChange, onClose, onOpenTitle }: {
  actor: Actor;
  role?: CreditRole;
  currentTitle?: { media_type: MediaType; id: number; name?: string };
  token?: string | null;
  onFavoriteChange?: () => void;
  onClose: () => void;
  onOpenTitle: (type: MediaType, id: number) => void;
}) {
  const [credits, setCredits] = useState<Credit[] | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState<MediaType | "all">("all");
  const [favorite, setFavorite] = useState<{ token: string; value: boolean } | null>(null);
  const [favoriteError, setFavoriteError] = useState<{ token: string; message: string } | null>(null);
  const [favoriteRetry, setFavoriteRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const [signInHint, setSignInHint] = useState(false);
  const favoritePath = `/api/me/favorite-people/${actor.id}`;
  const labels = creditLabels[role];
  const creditsPath = `/api/catalog/people/${actor.id}/credits${role === "acting" ? "" : `?role=${role}`}`;

  useEffect(() => {
    const request = new AbortController();
    api<{ items: Credit[] }>(creditsPath, undefined, { signal: request.signal })
      .then(data => { if (!request.signal.aborted) setCredits(data.items); })
      .catch(() => { if (!request.signal.aborted) setError(true); });
    return () => request.abort();
  }, [creditsPath, retry]);

  useEffect(() => {
    const request = new AbortController();
    api<Profile>(`/api/catalog/people/${actor.id}`, undefined, { signal: request.signal })
      .then(data => { if (!request.signal.aborted && data.id === actor.id) setProfile(data); })
      .catch(() => {});
    return () => request.abort();
  }, [actor.id]);

  useEffect(() => {
    if (!token) return;
    const request = new AbortController();
    api<{ favorited: boolean }>(favoritePath, token, { signal: request.signal })
      .then(data => { if (!request.signal.aborted) setFavorite({ token, value: data.favorited }); })
      .catch(() => {
        if (!request.signal.aborted) setFavoriteError({ token, message: "Couldn’t check favorite status." });
      });
    return () => request.abort();
  }, [favoritePath, token, favoriteRetry]);

  const isFavorite = favorite?.token === token ? favorite?.value : undefined;
  const currentError = favoriteError?.token === token ? favoriteError?.message : undefined;

  async function toggleFavorite() {
    if (!token) { setSignInHint(true); return; }
    if (isFavorite === undefined || saving) return;
    setSaving(true);
    setFavoriteError(null);
    try {
      await api(favoritePath, token, { method: isFavorite ? "DELETE" : "PUT" });
      setFavorite({ token, value: !isFavorite });
      onFavoriteChange?.();
    } catch {
      setFavoriteError({ token, message: "Couldn’t update favorites. Try again." });
    } finally {
      setSaving(false);
    }
  }

  const otherCredits = credits?.filter(credit => credit.id !== currentTitle?.id || credit.media_type !== currentTitle?.media_type);
  const featured = [...(otherCredits ?? [])].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0)).slice(0, 4);
  const filtered = otherCredits?.filter(credit => filter === "all" || credit.media_type === filter);
  const biography = profile?.biography?.trim();
  const age = profile ? ageOn(profile.birthday, profile.deathday) : null;
  const facts = [
    age === null ? "" : profile?.deathday ? `Age at death: ${age}` : `Age ${age}`,
    profile?.place_of_birth ? `Born in ${profile.place_of_birth}` : "",
  ].filter(Boolean);
  const open = (credit: Credit) => { onClose(); onOpenTitle(credit.media_type, credit.id); };

  return (
    <Modal label={`${actor.name} ${labels.credits}`} className="title-dialog actor-credits" onClose={onClose}>
      {currentTitle && <button className="actor-back secondary" onClick={onClose}>‹ Back to {labels.back}</button>}
      <div className="actor-profile">
        <ActorPortrait actor={{ ...actor, profile_path: profile?.profile_path || actor.profile_path }} />
        <div className="actor-overview">
          <div className="actor-heading">
            <h2>{actor.name}</h2>
            <button className={`actor-favorite secondary${isFavorite ? " is-favorite" : ""}`}
              aria-pressed={!!isFavorite} disabled={saving || (!!token && isFavorite === undefined)}
              onClick={() => void toggleFavorite()}>
              <span aria-hidden="true">{isFavorite ? "♥" : "♡"}</span> {isFavorite ? "Favorited" : "Favorite"}
            </button>
          </div>
          {currentTitle?.name && !!actor.characters?.length &&
            <p className="actor-role">Plays {actor.characters.join(", ")} in <em>{currentTitle.name}</em></p>}
          {facts.length > 0 && <p className="muted">{facts.join(" · ")}</p>}
          {signInHint && !token && <p role="status">Sign in to save favorite people.</p>}
          {currentError && <p className="form-error" role="alert">{currentError} {isFavorite === undefined &&
            <button className="secondary" onClick={() => { setFavoriteError(null); setFavoriteRetry(value => value + 1); }}>Retry</button>}</p>}
          {biography && <p className="actor-bio">{expanded || biography.length <= 300 ? biography : `${biography.slice(0, 300).trimEnd()}…`}
            {biography.length > 300 && <button className="actor-read-more" aria-expanded={expanded}
              onClick={() => setExpanded(value => !value)}>{expanded ? "Read less" : "Read more"}</button>}</p>}
          {featured.length > 0 && <section className="actor-featured">
            <h3>Featured credits</h3>
            <ul className="title-cast-list">
              {featured.map(credit => <li key={`${credit.media_type}:${credit.id}`}>
                <button className="title-cast-card" onClick={() => open(credit)}>
                  <Poster name={credit.name} posterPath={credit.poster_path} size="w185" />
                  <strong>{credit.name}</strong>
                </button>
              </li>)}
            </ul>
          </section>}
        </div>
      </div>
      <h3 className="actor-filmography-title">{role === "acting" ? "Filmography" : role === "creator" ? "Created by" : "Directed by"}</h3>
      {error ? (
        <>
          <p className="form-error" role="alert">Couldn’t load {labels.credits}.</p>
          <button className="secondary" onClick={() => { setError(false); setRetry(value => value + 1); }}>Try again</button>
        </>
      ) : !filtered ? <Skeleton label={`Loading ${labels.credits}…`} variant="rows" count={3} />
        : otherCredits?.length === 0 ? <p className="muted">No other {labels.credits} available.</p>
        : (
          <>
            <div className="actor-filters" role="group" aria-label={`Filter ${labels.credits}`}>
              {([["all", "All"], ["movie", "Movies"], ["tv", "TV"]] as const).map(([value, label]) =>
                <button key={value} className="secondary" aria-pressed={filter === value}
                  onClick={() => { setFilter(value); setVisibleCount(PAGE_SIZE); }}>{label}</button>)}
            </div>
            {filtered.length === 0 && <p className="muted">No credits in this category.</p>}
            <ul className="actor-filmography">
              {filtered.slice(0, visibleCount).map(credit => (
                <li key={`${credit.media_type}:${credit.id}`}>
                  <button className="actor-credit-row" onClick={() => open(credit)}>
                    <Poster name={credit.name} posterPath={credit.poster_path} size="w185" />
                    <strong>{credit.name}</strong>
                    <span className="muted">{[credit.media_type === "tv" ? "TV show" : "Movie", formatYear(credit.release_date)].filter(Boolean).join(" · ")}</span>
                    {credit.characters.length > 0 && <span>{credit.characters.join(", ")}</span>}
                  </button>
                </li>
              ))}
            </ul>
            {filtered.length > visibleCount && (
              <button className="secondary" onClick={() => setVisibleCount(count => count + PAGE_SIZE)}>Show more credits</button>
            )}
          </>
        )}
    </Modal>
  );
}
