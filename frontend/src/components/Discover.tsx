import { useEffect, useRef, useState, type FormEvent } from "react";
import Poster from "./Poster";
import { api } from "../data/api";
import { fetchRecommendations, formatYear, type MediaType, type Recommendation, type TitleSummary, type Post } from "../data/social";
import Skeleton from "./Skeleton";
import TitleDetails from "./TitleDetails";

type Title = {
  id: number;
  media_type: MediaType;
  name: string;
  release_date: string | null;
  overview: string;
  poster_path: string | null;
};
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
}) {
  const [query, setQuery] = useState("");
  const [serviceFilter, setServiceFilter] = useState(false);
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [resultPage, setResultPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [items, setItems] = useState<Title[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [recommended, setRecommended] = useState<Recommendation[] | null>(null);
  const [recommendedBasis, setRecommendedBasis] = useState("");
  const [recommendedError, setRecommendedError] = useState("");
  const searchRequest = useRef(0);
  const [localTitle, setLocalTitle] = useState<{ media_type: MediaType; id: number } | null>(null);

  async function loadSearch(text: string, page: number, filter: boolean) {
    if (!text.trim()) return;
    const request = ++searchRequest.current;
    setLoading(true); setError("");
    try {
      const path = filter ? "/api/me/catalog/search" : "/api/catalog/search";
      const data = await api<{ items: Title[]; page: number; total_pages: number }>(
        `${path}?query=${encodeURIComponent(text.trim())}&page=${page}`, filter ? token ?? undefined : undefined);
      if (request === searchRequest.current) {
        setItems(data.items); setSubmittedQuery(text.trim()); setResultPage(data.page); setTotalPages(data.total_pages);
      }
    } catch (err) {
      if (request === searchRequest.current) setError(err instanceof Error ? err.message : "Search failed.");
    } finally { if (request === searchRequest.current) setLoading(false); }
  }

  function search(event: FormEvent) {
    event.preventDefault();
    void loadSearch(query, 1, serviceFilter);
  }

  function toggleServiceFilter() {
    if (!token && !serviceFilter) { setError("Sign in and select streaming services in Account to use this filter."); return; }
    const next = !serviceFilter;
    setServiceFilter(next); setError("");
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
      setRecommended(null);
      return;
    }
    let active = true;
    setRecommendedError("");
    fetchRecommendations(token)
      .then((data) => {
        if (!active) return;
        setRecommended(data.items);
        setRecommendedBasis(data.basis);
      })
      .catch((err) => active && setRecommendedError(err instanceof Error ? err.message : "Recommendations are unavailable."));
    return () => {
      active = false;
    };
  }, [token]);

  useEffect(() => {
    if (!focus) return;
    setLocalTitle(focus);
    onFocusHandled?.();
  }, [focus, onFocusHandled]);

  return (
    <section className="discover-page">
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
            placeholder="Movie or show title"
            maxLength={200}
          />
          <button className="primary" disabled={loading || !query.trim()} type="submit">
            Search
          </button>
        </div>
      </form>
      <button type="button" className="secondary" aria-pressed={serviceFilter} disabled={loading} onClick={toggleServiceFilter}>
        Filter by my streaming services: {serviceFilter ? "On" : "Off"}
      </button>
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
            <p className="muted">No recommendations yet. Save a few genres in Account.</p>
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
      {error && <p role="alert" className="form-error">{error}</p>}
      {loading && !items && <Skeleton label="Loading search results…" variant="rows" />}
      {items && items.length === 0 && <p className="muted">{serviceFilter ? "No matching titles on this page. Try another results page or turn off the filter." : "No titles found. Try another search."}</p>}
      {submittedQuery && <div className="section-heading search-results-heading"><h2>Results for “{submittedQuery}”</h2><button className="text-button" onClick={() => { searchRequest.current += 1; setLoading(false); setSubmittedQuery(""); setItems(null); setQuery(""); setError(""); setResultPage(1); setTotalPages(0); }}>Clear search</button></div>}
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
