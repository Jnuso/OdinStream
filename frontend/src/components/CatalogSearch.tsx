import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../data/api";
import { formatYear, type MediaType } from "../data/social";
import type { Actor, CreditRole } from "./ActorCredits";
import Poster from "./Poster";
import Skeleton from "./Skeleton";

type Title = {
  id: number;
  media_type: MediaType;
  name: string;
  release_date: string | null;
  overview: string;
  poster_path: string | null;
};
type Person = Actor & { known_for_department?: string };

export default function CatalogSearch({ token, active = true, onOpenTitle, onOpenPerson }: {
  token: string | null;
  active?: boolean;
  onOpenTitle: (type: MediaType, id: number) => void;
  onOpenPerson: (person: Actor, role: CreditRole) => void;
}) {
  const [query, setQuery] = useState("");
  const [serviceFilter, setServiceFilter] = useState(false);
  const [mediaFilter, setMediaFilter] = useState<MediaType | "person" | null>(null);
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [resultPage, setResultPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [items, setItems] = useState<(Title | Person)[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const searchRequest = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const previousToken = useRef(token);

  useEffect(() => {
    if (active) input.current?.focus();
  }, [active]);

  async function loadSearch(text: string, page: number, filter: boolean, type = mediaFilter) {
    if (!text.trim()) return;
    const request = ++searchRequest.current;
    setLoading(true); setError("");
    try {
      const path = type === "person" ? "/api/catalog/people/search" : filter ? "/api/me/catalog/search" : "/api/catalog/search";
      const mediaParam = type && type !== "person" ? `&media_type=${type}` : "";
      const data = await api<{ items: (Title | Person)[]; page: number; total_pages: number }>(
        `${path}?query=${encodeURIComponent(text.trim())}&page=${page}${mediaParam}`, filter && type !== "person" ? token ?? undefined : undefined);
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
    void loadSearch(query, 1, serviceFilter);
  }

  function clearSearch() {
    searchRequest.current += 1;
    setLoading(false);
    setSubmittedQuery("");
    setItems(null);
    setQuery("");
    setError("");
    input.current?.focus();
  }

  function toggleServiceFilter() {
    if (!token && !serviceFilter) { setError("Sign in and select streaming services in Account to use this filter."); return; }
    const next = !serviceFilter;
    setServiceFilter(next); setError("");
    if (submittedQuery) void loadSearch(submittedQuery, 1, next);
  }

  useEffect(() => {
    const changed = previousToken.current !== token;
    previousToken.current = token;
    if (!changed) return;
    searchRequest.current += 1;
    setLoading(false);
    if (serviceFilter) {
      setServiceFilter(false);
      setItems(null);
      setSubmittedQuery("");
      setError("");
    }
  }, [token, serviceFilter]);

  return (
    <section className="discover-page">
      <div className="discover-header">
        <div className="page-heading"><h1>Search</h1></div>
        <form className="discover-search" onSubmit={search}>
          <label htmlFor="catalog-query">Search catalog</label>
          <div>
            <input
              ref={input}
              id="catalog-query"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search movies, shows, or people"
              maxLength={200}
            />
            <button className="primary" disabled={loading || !query.trim()} type="submit">
              Search
            </button>
          </div>
        </form>
      </div>
      {mediaFilter !== "person" && token && <div className="discover-services">
        <button type="button" className="secondary" aria-pressed={serviceFilter} disabled={loading} onClick={toggleServiceFilter}>
          Filter by my streaming services: {serviceFilter ? "On" : "Off"}
        </button>
      </div>}
      {error && <p role="alert" className="form-error">{error}</p>}
      {loading && !items && <Skeleton label="Loading search results…" variant="rows" />}
      <div className="section-heading search-results-heading">
        {submittedQuery && <h2>Results for “{submittedQuery}”</h2>}
        <div className="search-filters" aria-label="Search categories">
          {([[null, "All titles"], ["movie", "Movies"], ["tv", "Shows"], ["person", "People"]] as const).map(([type, label]) => (
            <button key={label} className="secondary" aria-pressed={mediaFilter === type} disabled={loading}
              onClick={() => submittedQuery ? void loadSearch(submittedQuery, 1, serviceFilter, type) : setMediaFilter(type)}>{label}</button>
          ))}
          {submittedQuery && <button className="text-button" onClick={clearSearch}>Clear search</button>}
        </div>
      </div>
      {items?.length === 0 && !loading && !error && (
        <p className="muted">{serviceFilter && mediaFilter !== "person"
          ? "No matching titles on this page. Try another results page or turn off the filter."
          : "No results found. Try another search."}</p>
      )}
      <div className="discover-results" aria-busy={loading}>
        {items?.map((item) => "media_type" in item ? (
          <button
            key={`${item.media_type}-${item.id}`}
            className="discover-result"
            onClick={() => onOpenTitle(item.media_type, item.id)}
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
        ) : (
          <button key={`person-${item.id}`} className="discover-result" onClick={() => onOpenPerson(item, item.known_for_department === "Directing" ? "director" : "acting")}>
            <Poster name={item.name} posterPath={item.profile_path ?? null} size="w185" />
            <span><strong>{item.name}</strong><small>{item.known_for_department || "Person"}</small></span>
          </button>
        ))}
      </div>
      {items && totalPages > 1 && <div className="pagination" aria-label="Search result pages">
        <button className="secondary" disabled={loading || resultPage <= 1} onClick={() => void loadSearch(submittedQuery, resultPage - 1, serviceFilter)}>Previous page</button>
        <span> Page {resultPage} of {totalPages} </span>
        <button className="secondary" disabled={loading || resultPage >= Math.min(totalPages, 500)} onClick={() => void loadSearch(submittedQuery, resultPage + 1, serviceFilter)}>Next page</button>
        {serviceFilter && mediaFilter !== "person" && <p className="muted small">Page numbers refer to all search results before filtering.</p>}
      </div>}
    </section>
  );
}
