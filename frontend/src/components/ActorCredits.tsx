import { useEffect, useState } from "react";
import { api } from "../data/api";
import { formatYear, type MediaType, type TitleSummary } from "../data/social";
import Modal from "./Modal";
import Poster from "./Poster";
import Skeleton from "./Skeleton";

type Credit = TitleSummary & { characters: string[] };
const PAGE_SIZE = 12;

export default function ActorCredits({ actor, currentTitle, onClose, onOpenTitle }: {
  actor: { id: number; name: string };
  currentTitle: { media_type: MediaType; id: number };
  onClose: () => void;
  onOpenTitle: (type: MediaType, id: number) => void;
}) {
  const [credits, setCredits] = useState<Credit[] | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    const request = new AbortController();
    api<{ items: Credit[] }>(`/api/catalog/people/${actor.id}/credits`, undefined, { signal: request.signal })
      .then(data => { if (!request.signal.aborted) setCredits(data.items); })
      .catch(() => { if (!request.signal.aborted) setError(true); });
    return () => request.abort();
  }, [actor.id, retry]);

  const otherCredits = credits?.filter(credit => credit.id !== currentTitle.id || credit.media_type !== currentTitle.media_type);

  return (
    <Modal label={`${actor.name} acting credits`} className="title-dialog actor-credits" onClose={onClose}>
      <h2>{actor.name}</h2>
      <h3>Other movies and TV shows</h3>
      {error ? (
        <>
          <p className="form-error" role="alert">Couldn’t load acting credits.</p>
          <button className="secondary" onClick={() => { setError(false); setRetry(value => value + 1); }}>Try again</button>
        </>
      ) : !otherCredits ? <Skeleton label="Loading acting credits…" variant="rows" count={3} />
        : otherCredits.length === 0 ? <p className="muted">No other acting credits available.</p>
        : (
          <>
            <ul className="title-cast-list">
              {otherCredits.slice(0, visibleCount).map(credit => (
                <li key={`${credit.media_type}:${credit.id}`}>
                  <button className="title-cast-card" onClick={() => { onClose(); onOpenTitle(credit.media_type, credit.id); }}>
                    <Poster name={credit.name} posterPath={credit.poster_path} size="w185" />
                    <strong>{credit.name}</strong>
                    <span className="muted">{[credit.media_type === "tv" ? "TV show" : "Movie", formatYear(credit.release_date)].filter(Boolean).join(" · ")}</span>
                    {credit.characters.length > 0 && <span>{credit.characters.join(", ")}</span>}
                  </button>
                </li>
              ))}
            </ul>
            {otherCredits.length > visibleCount && (
              <button className="secondary" onClick={() => setVisibleCount(count => count + PAGE_SIZE)}>Show more credits</button>
            )}
          </>
        )}
    </Modal>
  );
}
