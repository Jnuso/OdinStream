import { useEffect, useId, useState } from "react";
import { api } from "../data/api";
import { favoriteKey, type Favorite } from "../data/favorites";

type SearchResults = { items: Favorite[]; page: number; total_pages: number };

export default function FavoritesPicker({ scope = "all", selected, disabled, onAdd, onRemove }: {
  scope?: "all" | "titles" | "people";
  selected: Favorite[];
  disabled: boolean;
  onAdd: (item: Favorite) => void;
  onRemove: (item: Favorite) => void;
}) {
  const id = useId();
  const [category, setCategory] = useState(scope === "people" ? "people" : "titles");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState<{ key: string; results?: SearchResults; error?: string }>();
  const term = query.trim();
  const searchKey = JSON.stringify([category, term, page, attempt]);

  useEffect(() => {
    if (!term) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ query: term, page: String(page) });
    if (category === "movie" || category === "tv") params.set("media_type", category);
    const path = category === "people" ? "people/search" : "search";
    const timer = window.setTimeout(async () => {
      try {
        const results = await api<SearchResults>(`/api/catalog/${path}?${params}`, undefined, { signal: controller.signal });
        if (!controller.signal.aborted) setSearch({ key: searchKey, results });
      } catch (error) {
        if (!controller.signal.aborted) setSearch({ key: searchKey, error: error instanceof Error ? error.message : "Search failed." });
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [category, page, searchKey, term]);

  const current = search?.key === searchKey ? search : undefined;
  const results = current?.results;
  const selectedKeys = new Set(selected.map(favoriteKey));

  return <fieldset className="favorite-picker" disabled={disabled}>
    {scope === "all" && <legend>Favorite movies, shows, actors and directors</legend>}
    <div className={scope === "people" ? undefined : "favorite-search-fields"}>
      {scope !== "people" && <div className="setup-field">
        <label htmlFor={`${id}-category`}>Search for</label>
        <select id={`${id}-category`} value={category} onChange={event => {
          setCategory(event.target.value);
          setPage(1);
        }}>
          <option value="titles">Movies and TV shows</option>
          <option value="movie">Movies</option>
          <option value="tv">TV shows</option>
          {scope === "all" && <option value="people">Actors and directors</option>}
        </select>
      </div>}
      <div className="setup-field">
        <label htmlFor={`${id}-query`}>{category === "people" ? "Name" : "Title"}</label>
        <input id={`${id}-query`} type="search" value={query} maxLength={200} onKeyDown={event => {
          if (event.key === "Enter") event.preventDefault();
        }} onChange={event => {
          setQuery(event.target.value);
          setPage(1);
        }} />
      </div>
    </div>
    {term && !current && <p role="status">Searching…</p>}
    {current?.error && <div>
      <p role="alert">{current.error}</p>
      <button type="button" className="secondary" onClick={() => setAttempt(value => value + 1)}>Retry search</button>
    </div>}
    {results && (results.items.length ? <>
      <ul className="favorite-results" aria-label="Search results">
        {results.items.map(item => {
          const added = selectedKeys.has(favoriteKey(item));
          const kind = item.media_type === "movie" ? "Movie" : item.media_type === "tv" ? "TV show" : item.known_for_department;
          const context = [kind, item.release_date?.slice(0, 4), item.known_for?.join(", ")].filter(Boolean).join(" · ");
          const imagePath = item.poster_path ?? item.profile_path;
          return <li key={favoriteKey(item)}>
            {imagePath && <img src={`https://image.tmdb.org/t/p/w92${imagePath}`} alt="" loading="lazy" />}
            <span>{item.name}{context && <small>{context}</small>}</span>
            <button type="button" className="secondary" disabled={added} aria-label={`${added ? "Added" : "Add"} ${item.name}${context ? `, ${context}` : ""}`}
              onClick={() => onAdd(item)}>{added ? "Added" : "Add"}</button>
          </li>;
        })}
      </ul>
      {results.total_pages > 1 && <div className="favorite-paging">
        <button type="button" className="secondary" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous results</button>
        <button type="button" className="secondary" disabled={page >= Math.min(results.total_pages, 500)} onClick={() => setPage(value => value + 1)}>More results</button>
      </div>}
    </> : <p role="status">No matches found.</p>)}
    {selected.length > 0 && <ul className="favorite-picks" aria-label="Selected favorites">
      {selected.map(item => <li key={favoriteKey(item)}>
        <button type="button" className="secondary" onClick={() => onRemove(item)}
          aria-label={`Remove ${item.name}${item.media_type === "tv" ? ", TV show" : item.media_type === "movie" ? ", movie" : ""}`}>
          {item.name} <span aria-hidden="true">×</span>
        </button>
      </li>)}
    </ul>}
  </fieldset>;
}
