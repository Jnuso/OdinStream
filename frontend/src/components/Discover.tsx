import { useEffect, useState } from "react";
import { fetchRecommendations, formatYear, type MediaType, type Recommendation } from "../data/social";
import type { createPreferencesCache } from "../data/preferencesCache";
import Poster from "./Poster";
import Skeleton from "./Skeleton";

export default function Discover({ token, onOpenTitle, onOpenAccount, onOpenFeatured, preferencesCache, version = 0 }: {
  token: string | null;
  onOpenTitle?: (type: MediaType, id: number) => void;
  onOpenAccount?: () => void;
  onOpenFeatured?: () => void;
  preferencesCache?: ReturnType<typeof createPreferencesCache>;
  version?: number;
}) {
  const [serviceFilter, setServiceFilter] = useState(false);
  const [services, setServices] = useState<string[]>([]);
  const [recommended, setRecommended] = useState<Recommendation[] | null>(null);
  const [recommendedError, setRecommendedError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!token) return;
    let active = true;
    setRecommended(null);
    setRecommendedError("");
    fetchRecommendations(token, serviceFilter)
      .then(data => {
        if (active) setRecommended(data.basis === "popular" ? [] : data.items);
      })
      .catch(error => {
        if (active) setRecommendedError(error instanceof Error ? error.message : "Recommendations are unavailable.");
      });
    return () => { active = false; };
  }, [token, serviceFilter, version, retry]);

  useEffect(() => {
    if (!token || !preferencesCache) return;
    let active = true;
    preferencesCache.load()
      .then(data => { if (active) setServices(data.streaming_services ?? []); })
      .catch(() => {});
    return () => { active = false; };
  }, [token, preferencesCache]);

  return (
    <section className="discover-page">
      <div className="page-heading"><div><h1>Discover</h1><p>Movies and shows picked for your tastes.</p></div></div>
      {!token ? <div className="empty">
        <h2>Find picks for you</h2>
        <p>Sign in and choose a few favorites to get recommendations.</p>
        <button className="primary" onClick={onOpenAccount}>Sign in</button>
        <button className="secondary" onClick={onOpenFeatured}>Browse Featured</button>
      </div> : <>
        <div className="discover-services">
          <button type="button" className="secondary" aria-pressed={serviceFilter}
            disabled={Boolean(preferencesCache) && services.length === 0} onClick={() => setServiceFilter(value => !value)}>
            Filter by my streaming services: {serviceFilter ? "On" : "Off"}
          </button>
          <button className="secondary" onClick={onOpenAccount}>Manage tastes and services</button>
        </div>
        <section className="recommendations" aria-label="Recommended titles">
          <div className="section-heading"><h2>For you</h2></div>
          {recommendedError ? <div role="alert">
            <p className="form-error">{recommendedError}</p>
            <button className="secondary" onClick={() => setRetry(value => value + 1)}>Try again</button>
          </div> : recommended === null ? <Skeleton label="Loading recommendations…" variant="posters" />
            : recommended.length === 0 ? <div className="empty">
              <h3>{serviceFilter ? "No picks on your saved services" : "Add a few favorites"}</h3>
              <p>{serviceFilter ? "Turn off the service filter to see more picks." : "Pick genres in Account, or favorite a title or person while browsing."}</p>
              <button className="secondary" onClick={onOpenFeatured}>Browse Featured</button>
            </div> : (
            <div className="discover-results recommendation-grid">
              {recommended.map((item) => (
                <button
                  key={`${item.media_type}-${item.id}`}
                  className="discover-result"
                  onClick={() => onOpenTitle?.(item.media_type, item.id)}
                >
                  <Poster name={item.name} posterPath={item.poster_path} size="w185" />
                  <span>
                    <strong>{item.name}</strong>
                    <small>
                      {item.media_type === "tv" ? "TV show" : "Movie"}
                      {formatYear(item.release_date) ? ` · ${formatYear(item.release_date)}` : ""}
                      {item.reason ? ` · because you like ${item.reason}` : ""}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      </>}
    </section>
  );
}
