import { useEffect, useRef, useState, type FormEvent } from "react";
import Modal from "./Modal";
import Poster from "./Poster";
import { api } from "../data/api";
import { fetchRecommendations, formatYear, type MediaType, type Recommendation, type TitleSummary, type Post } from "../data/social";
import PostCard from "./PostCard";
import Skeleton from "./Skeleton";

type Title = {
  id: number;
  media_type: MediaType;
  name: string;
  release_date: string | null;
  overview: string;
  poster_path: string | null;
};
type Details = Title & {
  runtime: number | null;
  genres: string[];
  seasons: { season_number: number; name: string; episode_count: number }[];
  availability: { link: string | null; flatrate: string[]; rent: string[]; buy: string[] };
};
type Episode = { episode_number: number; name: string; overview: string; air_date: string | null };
type SavedTitle = { media_type: MediaType; tmdb_id: number; status: string };
type LibraryCheck = { token: string; mediaType: MediaType; id: number; status: string | null; error?: string };

export default function Discover({
  token,
  focus,
  onFocusHandled,
  onReview,
  onOpenProfile,
  onEdit,
  viewerId,
  reloadKey = 0,
}: {
  token: string | null;
  focus: { media_type: MediaType; id: number } | null;
  onFocusHandled: () => void;
  onReview?: (title: TitleSummary) => void;
  onOpenProfile?: (id: string) => void;
  onEdit?: (post: Post) => void;
  viewerId?: string;
  reloadKey?: number;
}) {
  const [query, setQuery] = useState("");
  const [serviceFilter, setServiceFilter] = useState(false);
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [resultPage, setResultPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [items, setItems] = useState<Title[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<Details | null>(null);
  const [episodes, setEpisodes] = useState<Episode[] | null>(null);
  const [episodeError, setEpisodeError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [recommended, setRecommended] = useState<Recommendation[] | null>(null);
  const [recommendedBasis, setRecommendedBasis] = useState("");
  const [recommendedError, setRecommendedError] = useState("");
  const [reviewPosts, setReviewPosts] = useState<Post[] | null>(null);
  const [reviewError, setReviewError] = useState("");
  const [libraryCheck, setLibraryCheck] = useState<LibraryCheck | null>(null);
  const [libraryRetry, setLibraryRetry] = useState(0);
  const searchRequest = useRef(0);
  const detailRequest = useRef(0);
  const seasonRequest = useRef(0);
  const currentLibraryCheck = detail && libraryCheck?.token === token && libraryCheck.mediaType === detail.media_type && libraryCheck.id === detail.id ? libraryCheck : null;

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

  async function openTitle(mediaType: MediaType, id: number) {
    const request = ++detailRequest.current;
    seasonRequest.current += 1;
    setDetailLoading(true);
    setSaving(false);
    setError("");
    setEpisodes(null);
    setEpisodeError("");
    setSaveMessage("");
    setReviewPosts(null);
    setReviewError("");
    try {
      const data = await api<Details>(`/api/catalog/${mediaType}/${id}`);
      if (request === detailRequest.current) setDetail(data);
    } catch (err) {
      if (request === detailRequest.current) setError(err instanceof Error ? err.message : "Could not load title details.");
    } finally {
      if (request === detailRequest.current) setDetailLoading(false);
    }
  }

  async function openSeason(season: number) {
    if (!detail) return;
    const request = ++seasonRequest.current;
    setEpisodes(null);
    setEpisodeError("");
    try {
      const data = await api<{ episodes: Episode[] }>(`/api/catalog/tv/${detail.id}/seasons/${season}`);
      if (request === seasonRequest.current) setEpisodes(data.episodes);
    } catch (err) {
      if (request === seasonRequest.current) setEpisodeError(err instanceof Error ? err.message : "Could not load episodes.");
    }
  }

  async function saveTitle() {
    if (!token || !detail || !currentLibraryCheck || currentLibraryCheck.error || currentLibraryCheck.status || saving) return;
    const request = detailRequest.current;
    setSaving(true);
    setSaveMessage("");
    try {
      await api("/api/me/saved-titles", token, {
        method: "POST",
        body: JSON.stringify({ media_type: detail.media_type, tmdb_id: detail.id, status: "watchlist" }),
      });
      if (request !== detailRequest.current) return;
      setSaveMessage("Added to your watchlist.");
      setLibraryCheck({ token, mediaType: detail.media_type, id: detail.id, status: "watchlist" });
    } catch (err) {
      if (request === detailRequest.current) setSaveMessage(err instanceof Error ? err.message : "Could not save title.");
    } finally {
      if (request === detailRequest.current) setSaving(false);
    }
  }

  useEffect(() => () => {
    searchRequest.current += 1;
    detailRequest.current += 1;
    seasonRequest.current += 1;
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
    void openTitle(focus.media_type, focus.id);
    onFocusHandled();
  }, [focus]);

  useEffect(() => {
    if (!detail || !token) return;
    let active = true;
    api<{ items: Post[] }>(`/api/titles/${detail.media_type}/${detail.id}/posts`, token)
      .then(data => { if (active) setReviewPosts(data.items); })
      .catch(err => { if (active) setReviewError(err instanceof Error ? err.message : "Could not load reviews."); });
    return () => { active = false; };
  }, [detail, token, reloadKey]);

  useEffect(() => {
    if (!detail || !token) return;
    let active = true;
    const identity = { token, mediaType: detail.media_type, id: detail.id };
    async function checkLibrary() {
      try {
        let offset: number | null = 0;
        while (offset !== null) {
          const page: { items: SavedTitle[]; next_offset?: number | null } = await api(
            `/api/me/saved-titles?media_type=${identity.mediaType}&limit=50&offset=${offset}`, token!);
          if (!active) return;
          const saved = page.items.find(item => item.media_type === identity.mediaType && item.tmdb_id === identity.id);
          if (saved) { setLibraryCheck({ ...identity, status: saved.status }); return; }
          offset = page.next_offset ?? null;
        }
        if (active) setLibraryCheck({ ...identity, status: null });
      } catch {
        if (active) setLibraryCheck({ ...identity, status: null, error: "Could not check your library." });
      }
    }
    void checkLibrary();
    return () => { active = false; };
  }, [detail, token, libraryRetry]);

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
                  disabled={detailLoading}
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
      {detailLoading && <div className="title-loading-indicator" role="status" aria-label="Loading title details…"><span aria-hidden="true" /><span className="sr-only">Loading title details…</span></div>}
      {items && items.length === 0 && <p className="muted">{serviceFilter ? "No matching titles on this page. Try another results page or turn off the filter." : "No titles found. Try another search."}</p>}
      {submittedQuery && <div className="section-heading search-results-heading"><h2>Results for “{submittedQuery}”</h2><button className="text-button" onClick={() => { searchRequest.current += 1; setLoading(false); setSubmittedQuery(""); setItems(null); setQuery(""); setError(""); setResultPage(1); setTotalPages(0); }}>Clear search</button></div>}
      <div className="discover-results">
        {items?.map((item) => (
          <button
            key={`${item.media_type}-${item.id}`}
            className="discover-result"
            onClick={() => openTitle(item.media_type, item.id)}
            disabled={detailLoading}
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
      {detail && (
        <Modal
          className="title-dialog"
          label={`${detail.name} details`}
          onClose={() => {
            detailRequest.current += 1;
            seasonRequest.current += 1;
            setSaving(false);
            setDetailLoading(false);
            setDetail(null);
            setEpisodes(null);
          }}
        >
          <div className="discover-detail">
            <Poster name={detail.name} posterPath={detail.poster_path} size="w342" />
            <div>
              <h2>{detail.name}</h2>
              <p className="muted">
                {detail.media_type === "tv" ? "TV show" : "Movie"}
                {formatYear(detail.release_date) ? ` · ${formatYear(detail.release_date)}` : ""}
                {detail.runtime ? ` · ${detail.runtime} min` : ""}
              </p>
              {detail.genres.length > 0 && <p>{detail.genres.join(" · ")}</p>}
              <p>{detail.overview || "No description available."}</p>
            </div>
          </div>
          <div className="discover-save">
            {token ? (
              <>
              {currentLibraryCheck?.error ? <button className="secondary" onClick={() => { setLibraryCheck(null); setLibraryRetry(value => value + 1); }}>Retry library check</button> : <button className={currentLibraryCheck?.status ? "secondary" : "primary"} disabled={saving || !currentLibraryCheck || !!currentLibraryCheck.status} onClick={saveTitle}>
                {saving ? "Adding…" : !currentLibraryCheck ? "Checking library…" : currentLibraryCheck.status === "watchlist" ? "✓ In your watchlist" : currentLibraryCheck.status ? ({ watching: "Watching", watched: "Watched", completed: "Completed", paused: "Paused", dropped: "Dropped" }[currentLibraryCheck.status] ?? "In your library") : "Add to watchlist"}
              </button>}
              {onReview && <button className="secondary" onClick={() => {
                const own = reviewPosts?.find(post => post.author.id === viewerId);
                if (own && onEdit) onEdit(own); else onReview(detail);
              }}>{onEdit && reviewPosts?.some(post => post.author.id === viewerId) ? "Edit your review" : "Write a review"}</button>}
              </>
            ) : (
              <p>Sign in from Account to save this title.</p>
            )}
            {saveMessage && <p role="status">{saveMessage}</p>}
            {currentLibraryCheck?.error && <p className="form-error" role="alert">{currentLibraryCheck.error}</p>}
          </div>
          <section className="discover-watch">
            <h3>Where to watch in the United States</h3>
            {([
              ["flatrate", "Stream"],
              ["rent", "Rent"],
              ["buy", "Buy"],
            ] as const).map(
              ([key, label]) =>
                detail.availability[key].length > 0 && (
                  <p key={key}>
                    <strong>{label}:</strong> {detail.availability[key].join(", ")}
                  </p>
                ),
            )}
            {!detail.availability.flatrate.length &&
              !detail.availability.rent.length &&
              !detail.availability.buy.length && (
                <p>Availability information is not available for this country.</p>
              )}
            {detail.availability.link && (
              <a href={detail.availability.link} target="_blank" rel="noreferrer">
                View watch options on TMDB
              </a>
            )}
            <p className="muted">Availability data provided by JustWatch.</p>
          </section>
          <section className="title-reviews">
            <h3>Ratings &amp; reviews</h3>
            {!token ? <p className="muted">Sign in to read and share reviews.</p>
              : reviewError ? <p className="form-error" role="alert">{reviewError}</p>
              : reviewPosts === null ? <Skeleton label="Loading reviews…" variant="posts" count={2} />
              : reviewPosts.length === 0 ? <p className="muted">No reviews yet. Share what you thought.</p>
              : <div className="post-list">{reviewPosts.map(post => (
                <PostCard key={post.id} post={post} isOwn={false}
                  onOpenProfile={id => { setDetail(null); onOpenProfile?.(id); }}
                  onOpenTitle={(type, id) => void openTitle(type, id)}
                  onEdit={() => {}} onDelete={() => {}} />
              ))}</div>}
          </section>
          {detail.seasons.length > 0 && (
            <section className="discover-seasons">
              <h3>Seasons</h3>
              {detail.seasons.map((season) => (
                <button className="secondary" key={season.season_number} onClick={() => openSeason(season.season_number)}>
                  {season.name} ({season.episode_count})
                </button>
              ))}
              {episodeError && <p className="form-error" role="alert">{episodeError}</p>}
              {episodes &&
                (episodes.length ? (
                  <ol>
                    {episodes.map((episode) => (
                      <li key={episode.episode_number}>
                        <strong>{episode.name || `Episode ${episode.episode_number}`}</strong>
                        {episode.air_date && ` · ${episode.air_date}`}
                        {episode.overview && <p>{episode.overview}</p>}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p>No episode information available.</p>
                ))}
            </section>
          )}
        </Modal>
      )}
    </section>
  );
}
