import { useEffect, useState } from "react";
import { api } from "../data/api";
import type { MediaType } from "../data/social";
import ActorCredits, { ActorPortrait, type Actor } from "./ActorCredits";

export default function FavoritePeople({ token, version, onChange, onOpenTitle }: {
  token: string;
  version: number;
  onChange: () => void;
  onOpenTitle: (type: MediaType, id: number) => void;
}) {
  const [actors, setActors] = useState<Actor[] | null>(null);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<Actor | null>(null);

  useEffect(() => {
    const request = new AbortController();
    api<{ items: Actor[] }>("/api/me/favorite-people", token, { signal: request.signal })
      .then(data => {
        if (!request.signal.aborted) {
          setActors(data.items);
          setError(false);
        }
      })
      .catch(() => { if (!request.signal.aborted) setError(true); });
    return () => request.abort();
  }, [token, version]);

  return <section className="favorite-people" aria-label="Favorite people">
    <h2>Favorite people</h2>
    {error ? <p className="form-error" role="alert">Couldn’t load favorite people.{" "}
      <button className="secondary" onClick={onChange}>Retry</button></p>
      : !actors ? <p className="muted" role="status">Loading favorite people…</p>
      : actors.length === 0 ? <p className="muted">Save an actor from a show’s cast to find them here.</p>
      : <ul className="title-cast-list">{actors.map(actor => <li key={actor.id}>
        <button className="title-cast-card" onClick={() => setSelected(actor)}>
          <ActorPortrait actor={actor} /><strong>{actor.name}</strong>
        </button>
      </li>)}</ul>}
    {selected && <ActorCredits key={selected.id} actor={selected} token={token} onFavoriteChange={onChange}
      onClose={() => setSelected(null)} onOpenTitle={onOpenTitle} />}
  </section>;
}
