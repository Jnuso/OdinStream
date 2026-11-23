import { useEffect, useRef, useState, type FormEvent } from "react";
import Poster from "./Poster";
import { api } from "../data/api";
import { cachedCatalog } from "../data/catalogCache";
import { fetchRecommendations, formatYear, type MediaType, type Recommendation, type TitleSummary, type Post } from "../data/social";
import Skeleton from "./Skeleton";
import TitleDetails from "./TitleDetails";
import type { createPreferencesCache, Preferences } from "../data/preferencesCache";

type Title = {
  id: number;
  media_type: MediaType;
  name: string;
  release_date: string | null;
  overview: string;
  poster_path: string | null;
};
type TrendingTitle = Title & { backdrop_path: string | null };

export default function Discover({
  token,
  focus = null,
  onFocusHandled,
  onReview,
  onOpenProfile,
  onEdit,
  viewerId,
  reloadKey = 0,
  onOpenTitle,
  onOpenAccount,
  onReady,
  preferencesCache,
}: {
  token: string | null;
  focus?: { media_type: MediaType; id: number } | null;
  onFocusHandled?: () => void;
  onReview?: (title: TitleSummary) => void;
  onOpenProfile?: (id: string) => void;
  onEdit?: (post: Post) => void;
  viewerId?: string;
  reloadKey?: number;
  onOpenTitle?: (type: MediaType, id: number) => void;
  onOpenAccount?: () => void;
  onReady?: (token: string) => void;
  preferencesCache?: ReturnType<typeof createPreferencesCache>;
}) {
  const [query, setQuery] = useState("");
  const [serviceFilter, setServiceFilter] = useState(false);
  const [mediaFilter, setMediaFilter] = useState<MediaType | null>(null);
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [resultPage, setResultPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [items, setItems] = useState<Title[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [recommended, setRecommended] = useState<Recommendation[] | null>(null);
  const [recommendedBasis, setRecommendedBasis] = useState("");
  const [recommendedError, setRecommendedError] = useState("");
  const [services, setServices] = useState<{ token: string; names: string[] } | null>(null);
  const showServices = Boolean(onOpenAccount);
  const [trending, setTrending] = useState<TrendingTitle[]>([]);
  const [trendingSettled, setTrendingSettled] = useState(false);
  const [recommendationsToken, setRecommendationsToken] = useState<string | null>(null);
  const [preferencesToken, setPreferencesToken] = useState<string | null>(null);
  const [settledBackdrop, setSettledBackdrop] = useState<string | null>(null);
  const showTrending = Boolean(onOpenTitle);
  const searchRequest = useRef(0);
  const [localTitle, setLocalTitle] = useState<{ media_type: MediaType; id: number } | null>(null);

  async function loadSearch(text: string, page: number, filter: boolean, type = mediaFilter) {
    if (!text.trim()) return;
    const request = ++searchRequest.current;
    setLoading(true); setError("");
    try {
      const path = filter ? "/api/me/catalog/search" : "/api/catalog/search";
      const mediaParam = type ? `&media_type=${type}` : "";
      const data = await api<{ items: Title[]; page: number; total_pages: number }>(
        `${path}?query=${encodeURIComponent(text.trim())}&page=${page}${mediaParam}`, filter ? token ?? undefined : undefined);
      if (request === searchRequest.current) {
        setMediaFilter(type);
        setItems(data.items); setSubmittedQuery(text.trim()); setResultPage(data.page); setTotalPages(data.total_pages);
      }
    } catch (err) {
      if (request === searchRequest.current) setError(err instanceof Error ? err.message : "Search failed.");
    } finally { if (request === searchRequest.current) setLoading(false); }
  }

  function search(event: FormEvent) {
    event.preventDefault();
    void loadSearch(query, 1, serviceFilter, null);
  }

  function toggleServiceFilter() {
    if (!token && !serviceFilter) { setError("Sign in and select streaming services in Account to use this filter."); return; }
    const next = !serviceFilter;
    setServiceFilter(next); setError("");
    setRecommended(null); setRecommendedError("");
    if (submittedQuery) void loadSearch(submittedQuery, 1, next);
  }

  function openTitle(mediaType: MediaType, id: number) {
    if (onOpenTitle) onOpenTitle(mediaType, id);
    else setLocalTitle({ media_type: mediaType, id });
  }

  useEffect(() => () => {
    searchRequest.current += 1;
  }, [token]);

  useEffect(() => {
    if (!token) {
      setServiceFilter(false); setItems(null); setSubmittedQuery("");
      setRecommended(null); setRecommendedError("");
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    setRecommended(null);
    setRecommendedError("");
    fetchRecommendations(token, serviceFilter)
      .then((data) => {
        if (!active) return;
        setRecommended(data.items);
        setRecommendedBasis(data.basis);
      })
      .catch((err) => active && setRecommendedError(err instanceof Error ? err.message : "Recommendations are unavailable."))
      .finally(() => { if (active) setRecommendationsToken(token); });
    return () => {
      active = false;
    };
  }, [token, serviceFilter]);

  useEffect(() => {
    if (!focus) return;
    setLocalTitle(focus);
    onFocusHandled?.();
  }, [focus, onFocusHandled]);

  useEffect(() => {
    if (!token || !showServices) return;
    let active = true;
    (preferencesCache?.load() ?? api<Preferences>("/api/me/preferences", token))
      .then(data => {
        if (active && Array.isArray(data.streaming_services)) {
          setServices({ token, names: data.streaming_services });
        }
      })
      .catch(() => {})
      .finally(() => { if (active) setPreferencesToken(token); });
    return () => { active = false; };
  }, [token, showServices, preferencesCache]);

  useEffect(() => {
    if (!showTrending) return;
    let active = true;
    cachedCatalog<{ items: TrendingTitle[] }>("/api/catalog/trending")
      .then(data => { if (active && Array.isArray(data.items)) setTrending(data.items); })
      .catch(() => {})
      .finally(() => { if (active) setTrendingSettled(true); });
    return () => { active = false; };
  }, [showTrending]);

  const featured = submittedQuery ? undefined : trending[0];
  const backdrop = featured?.backdrop_path;

  useEffect(() => {
    if (!onReady || !token || submittedQuery || (showTrending && !trendingSettled)
      || recommendationsToken !== token || (showServices && preferencesToken !== token)
      || (backdrop && settledBackdrop !== backdrop)) return;
    // Allow the committed Discover content to paint before starting other requests.
    let afterPaint = 0;
    const frame = requestAnimationFrame(() => {
      afterPaint = requestAnimationFrame(() => onReady(token));
    });
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(afterPaint); };
  }, [onReady, token, submittedQuery, showTrending, trendingSettled, recommendationsToken, showServices, preferencesToken, backdrop, settledBackdrop]);

  return (
    <section className="discover-page">
      <div className="discover-header">
        <div className="page-heading">
          <div>
            <h1>Discover</h1>
            <p>Find your next great watch.</p>
          </div>
        </div>
        <form className="discover-search" onSubmit={search}>
          <label htmlFor="discover-query">Search titles</label>
          <div>
            <input
              id="discover-query"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search movies and shows"
              maxLength={200}
            />
            <button className="primary" disabled={loading || !query.trim()} type="submit">
              Search
            </button>
          </div>
        </form>
      </div>
      <div className="discover-services">
        {services?.token === token && services.names.length > 0 && (
          <div className="service-chips" aria-label="Your streaming services">
            <span>Your services</span>
            {services.names.map(name => <span className="service-chip" key={name}>{name}</span>)}
          </div>
        )}
        <button type="button" className="secondary" aria-pressed={serviceFilter} disabled={loading} onClick={toggleServiceFilter}>
          Filter by my streaming services: {serviceFilter ? "On" : "Off"}
        </button>
        {onOpenAccount && <button className="secondary" onClick={onOpenAccount}>Manage services</button>}
      </div>
      {featured && (
        <section className="discover-feature" aria-labelledby="discover-feature-title">
          {backdrop && (
            <img className="discover-feature-art" src={`https://image.tmdb.org/t/p/w780${backdrop}`} alt=""
              onLoad={() => setSettledBackdrop(backdrop)} onError={() => setSettledBackdrop(backdrop)} />
          )}
          <div className="discover-feature-copy">
            <p className="discover-feature-label">Featured this week</p>
            <h2 id="discover-feature-title">{featured.name}</h2>
            <p>{featured.media_type === "tv" ? "TV show" : "Movie"}{formatYear(featured.release_date) && ` · ${formatYear(featured.release_date)}`}</p>
            {featured.overview && <p className="discover-feature-overview">{featured.overview}</p>}
            <button className="primary" type="button" onClick={() => openTitle(featured.media_type, featured.id)}>
              View details
            </button>
          </div>
        </section>
      )}
      {token && !submittedQuery && (
        <section className="recommendations" aria-label="Recommended titles">
          <div className="section-heading">
            <h2>For you</h2>
            {recommendedBasis !== "genres" && <p className="muted small">Popular picks</p>}
          </div>
          {recommendedError ? (
            <p className="muted">{recommendedError}</p>
          ) : recommended === null ? (
            <Skeleton label="Loading recommendations…" variant="posters" />
          ) : recommended.length === 0 ? (
            <p className="muted">{serviceFilter ? "No recommendations are available on your saved services." : "No recommendations yet. Save a few genres in Account."}</p>
          ) : (
            <div className="discover-results recommendation-grid">
              {recommended.map((item) => (
                <button
                  key={`${item.media_type}-${item.id}`}
                  className="discover-result"
                  onClick={() => openTitle(item.media_type, item.id)}
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
      )}
      {!submittedQuery && trending.length > 1 && (
        <section className="recommendations trending" aria-label="Trending titles">
          <div className="section-heading"><h2>Trending this week</h2></div>
          <div className="discover-results recommendation-grid">
            {trending.slice(1).map(item => (
              <button key={`${item.media_type}-${item.id}`} className="discover-result" onClick={() => openTitle(item.media_type, item.id)}>
                <Poster name={item.name} posterPath={item.backdrop_path || item.poster_path} size="w342" />
                <strong>{item.name}</strong>
              </button>
            ))}
          </div>
        </section>
      )}
      {error && <p role="alert" className="form-error">{error}</p>}
      {loading && !items && <Skeleton label="Loading search results…" variant="rows" />}
      {items && items.length === 0 && <p className="muted">{serviceFilter ? "No matching titles on this page. Try another results page or turn off the filter." : "No titles found. Try another search."}</p>}
      {submittedQuery && (
        <div className="section-heading search-results-heading">
          <h2>Results for “{submittedQuery}”</h2>
          <div className="search-filters" aria-label="Title types">
            {([[null, "All"], ["movie", "Movies"], ["tv", "Shows"]] as const).map(([type, label]) => (
              <button key={label} className="secondary" aria-pressed={mediaFilter === type} disabled={loading} onClick={() => void loadSearch(submittedQuery, 1, serviceFilter, type)}>{label}</button>
            ))}
            <button className="text-button" onClick={() => { searchRequest.current += 1; setLoading(false); setSubmittedQuery(""); setItems(null); setQuery(""); setError(""); setResultPage(1); setTotalPages(0); }}>Clear search</button>
          </div>
        </div>
      )}
      <div className="discover-results">
        {items?.map((item) => (
          <button
            key={`${item.media_type}-${item.id}`}
            className="discover-result"
            onClick={() => openTitle(item.media_type, item.id)}
          >
            <Poster name={item.name} posterPath={item.poster_path} size="w185" />
            <span>
              <strong>{item.name}</strong>
              <small>
                {item.media_type === "tv" ? "TV show" : "Movie"}
                {formatYear(item.release_date) ? ` · ${formatYear(item.release_date)}` : ""}
              </small>
            </span>
          </button>
        ))}
      </div>
      {items && totalPages > 1 && <div className="pagination" aria-label="Search result pages">
        <button className="secondary" disabled={loading || resultPage <= 1} onClick={() => void loadSearch(submittedQuery, resultPage - 1, serviceFilter)}>Previous page</button>
        <span> Page {resultPage} of {totalPages} </span>
        <button className="secondary" disabled={loading || resultPage >= Math.min(totalPages, 500)} onClick={() => void loadSearch(submittedQuery, resultPage + 1, serviceFilter)}>Next page</button>
        {serviceFilter && <p className="muted small">Page numbers refer to all search results before filtering.</p>}
      </div>}
      <p className="discover-attribution">
        Movie and TV data provided by{" "}
        <a href="https://www.themoviedb.org/" target="_blank" rel="noreferrer">TMDB</a>. Watch availability
        provided by <a href="https://www.justwatch.com/" target="_blank" rel="noreferrer">JustWatch</a>. This
        product uses the TMDB API but is not endorsed or certified by TMDB.
      </p>
      {localTitle && <TitleDetails key={`${localTitle.media_type}:${localTitle.id}`} selection={localTitle} token={token} viewerId={viewerId} reloadKey={reloadKey} onClose={() => setLocalTitle(null)} onReview={onReview} onOpenProfile={onOpenProfile} onEdit={onEdit} onOpenTitle={openTitle} />}
    </section>
  );
}
