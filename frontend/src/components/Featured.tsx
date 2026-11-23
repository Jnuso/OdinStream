import { useEffect, useState } from "react";
import { cachedCatalog } from "../data/catalogCache";
import { formatYear, type MediaType, type TitleSummary } from "../data/social";
import Poster from "./Poster";
import Skeleton from "./Skeleton";

export default function Featured({ onOpenTitle, onReady }: {
  onOpenTitle: (type: MediaType, id: number) => void;
  onReady: (ready: boolean) => void;
}) {
  const [items, setItems] = useState<TitleSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    cachedCatalog<{ items: TitleSummary[] }>("/api/catalog/trending")
      .then(data => { if (active) setItems(data.items); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [attempt]);

  useEffect(() => {
    if (items === null && !failed) return;
    let afterPaint = 0;
    const frame = requestAnimationFrame(() => {
      afterPaint = requestAnimationFrame(() => onReady(true));
    });
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(afterPaint); };
  }, [failed, items, onReady]);

  return <section className="discover-page">
    <div className="page-heading"><div><h1>Featured</h1><p>What’s trending this week.</p></div></div>
    {failed ? <div role="alert">
      <p>Trending titles are unavailable.</p>
      <button className="secondary" onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>Try again</button>
    </div> : items === null ? <Skeleton label="Loading trending titles…" variant="posters" />
      : ([["movie", "Trending movies"], ["tv", "Trending TV"]] as const).map(([type, label]) => {
        const titles = items.filter(item => item.media_type === type);
        return <section className="recommendations" key={type} aria-label={label}>
          <div className="section-heading"><h2>{label}</h2></div>
          {titles.length === 0 ? <p className="muted">No trending titles this week.</p> : <div className="discover-results recommendation-grid">
            {titles.map(item => <button className="discover-result" key={item.id} onClick={() => onOpenTitle(type, item.id)}>
              <Poster name={item.name} posterPath={item.poster_path} size="w342" />
              <span><strong>{item.name}</strong><small>{formatYear(item.release_date)}</small></span>
            </button>)}
          </div>}
        </section>;
      })}
  </section>;
}
