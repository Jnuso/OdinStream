import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../data/api";
import Poster from "./Poster";
import Modal from "./Modal";
import Skeleton from "./Skeleton";
import ShowProgress from "./ShowProgress";
import { cachedCatalog } from "../data/catalogCache";
import { createLibraryCache, type LibraryPage, type SavedEntry as Entry } from "../data/libraryCache";

type Season = { season_number: number; name: string; episode_count: number };
type Title = { name: string; poster_path: string | null; seasons: Season[] };
type LibraryEntry = Entry & { title?: Title };

function catalogPath(entry: Entry) {
  return `/api/catalog/${entry.media_type}/${entry.tmdb_id}`;
}

const statuses = { movie: ["watchlist", "watched"], tv: ["watchlist", "watching", "completed", "paused", "dropped"] };

export default function Library({ token, cache, version = 0, onOpenTitle }: {
  token: string | null;
  cache?: ReturnType<typeof createLibraryCache>;
  version?: number;
  onOpenTitle?: (type: "movie" | "tv", id: number) => void;
}) {
  const firstPage = useMemo(() => cache ?? createLibraryCache(token), [cache, token]);
  const [entries, setItems] = useState<Entry[]>(() => firstPage.peek()?.items ?? []);
  const [titles, setTitles] = useState<Record<string, Title | null>>({});
  const [loading, setLoading] = useState(!!token && !firstPage.peek());
  const [nextOffset, setNextOffset] = useState<number | null>(() => firstPage.peek()?.next_offset ?? null);
  const pageRequest = useRef(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [removing, setRemoving] = useState<LibraryEntry | null>(null);

  useEffect(() => {
    if (!token) { setItems([]); setNextOffset(null); setLoading(false); return; }
    let active = true;
    setLoading(true); setError("");
    firstPage.load().then(data => {
      if (active) { setItems(data.items); setNextOffset(data.next_offset ?? null); }
    }).catch(err => { if (active) setError(err instanceof Error ? err.message : "Could not load your library."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; pageRequest.current += 1; };
  }, [firstPage, token, version]);

  useEffect(() => {
    let active = true;
    for (const entry of entries) {
      const path = catalogPath(entry);
      cachedCatalog<Title>(path).catch(() => null).then(title => {
        if (active) setTitles(previous => previous[path] === title ? previous : { ...previous, [path]: title });
      });
    }
    return () => { active = false; };
  }, [entries]);

  async function loadMore() {
    if (!token || nextOffset === null || loading || busy) return;
    const request = ++pageRequest.current;
    setLoading(true); setError("");
    try {
      const data = await api<LibraryPage>(`/api/me/saved-titles?offset=${nextOffset}`, token);
      if (request !== pageRequest.current) return;
      setItems(previous => [...previous, ...data.items.filter(item => !previous.some(entry => entry.id === item.id))]);
      setNextOffset(data.next_offset ?? null);
    } catch (err) {
      if (request === pageRequest.current) setError(err instanceof Error ? err.message : "Could not load more titles.");
    } finally {
      if (request === pageRequest.current) setLoading(false);
    }
  }

  async function update(entry: Entry, status: string) {
    if (!token || busy || loading) return;
    setBusy(entry.id); setError("");
    setItems(previous => previous.map(item => item.id === entry.id ? { ...item, status } : item));
    try {
      await api(`/api/me/saved-titles/${entry.id}`, token, { method: "PATCH", body: JSON.stringify({ status }) });
      firstPage.invalidate();
    } catch (err) {
      setItems(previous => previous.map(item => item.id === entry.id ? { ...item, status: entry.status } : item));
      setError(err instanceof Error ? err.message : "Could not update title.");
    }
    finally { setBusy(null); }
  }
  async function remove(entry: Entry) {
    if (!token || busy || loading) return;
    setBusy(entry.id); setError("");
    try {
      await api(`/api/me/saved-titles/${entry.id}`, token, { method: "DELETE" });
      firstPage.invalidate();
      setItems(previous => previous.filter(item => item.id !== entry.id));
      setRemoving(null);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not remove title."); }
    finally { setBusy(null); }
  }

  const items: LibraryEntry[] = entries.map(entry => ({ ...entry, title: titles[catalogPath(entry)] ?? undefined }));
  const visible = items.filter(item => filter === "all" || (filter === "watched" ? ["watched", "completed"].includes(item.status) : item.status === filter));
  const labels: Record<string, string> = { all: "All titles", watching: "Watching", watchlist: "Watchlist", watched: "Watched", paused: "Paused", dropped: "Dropped", completed: "Completed" };
  return <section className="library-page"><div className="page-heading"><div><h1>My Library</h1><p>A home for everything you’re watching, saving, and coming back to.</p></div><span className="count-badge">{items.length}{nextOffset !== null ? "+" : ""} titles</span></div>
    {!token ? <p>Sign in from Account to view your library.</p> : <>
      <div className="library-tabs" aria-label="Library filters">{["all", "watching", "watchlist", "watched", "paused", "dropped"].map(value => <button key={value} aria-pressed={filter === value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{labels[value]}</button>)}</div>
      {error && <p className="form-error" role="alert">{error}</p>}{loading && items.length === 0 && <Skeleton label="Loading library…" variant="rows" />}
      {!loading && !error && visible.length === 0 && <div className="empty"><h2>{items.length ? `Nothing ${filter === "all" ? "here" : `in ${labels[filter].toLowerCase()}`} yet.` : "Your next favorite belongs here."}</h2><p>{items.length ? "Choose another filter or find something new in Discover." : "Find a movie or show in Discover and add it to your watchlist."}</p></div>}
      <div className="post-list">{visible.map(item => <article className="post-card library-entry" key={item.id}>
        <button className="library-title" onClick={() => onOpenTitle?.(item.media_type, item.tmdb_id)} disabled={!onOpenTitle}>
          <Poster name={item.title?.name || "?"} posterPath={item.title?.poster_path ?? null} size="w185" />
          <span><strong>{item.title?.name || `${item.media_type === "tv" ? "TV show" : "Movie"} · TMDB ${item.tmdb_id}`}</strong>
          <small>{item.media_type === "tv" ? "TV show" : "Movie"} · {labels[item.status]}</small>
          {!item.title && <small>{titles[catalogPath(item)] === null ? "Title details are unavailable; your saved entry is intact." : "Loading title details…"}</small>}</span></button>
        <label className="library-status"><span className="sr-only">Status for {item.title?.name || item.tmdb_id}</span><select aria-label={`Status for ${item.title?.name || item.tmdb_id}`} value={item.status} aria-disabled={busy !== null || loading} onChange={event => { if (!busy && !loading) void update(item, event.target.value); }}>
          {statuses[item.media_type].map(status => <option key={status} value={status}>{labels[status]}</option>)}</select></label>
        {item.media_type === "tv" && <button className="secondary" aria-expanded={expanded === item.id} onClick={() => setExpanded(expanded === item.id ? null : item.id)}>Episode progress</button>}
        <button className="library-remove" aria-disabled={busy !== null || loading} onClick={() => { if (!busy && !loading) setRemoving(item); }}>Remove</button>
        {item.media_type === "tv" && (item.status !== "completed" || expanded === item.id) && (
          <ShowProgress entry={item} token={token} expanded={expanded === item.id} />
        )}
      </article>)}</div>
      {nextOffset !== null && <button className="secondary" disabled={loading || busy !== null} onClick={() => void loadMore()}>{loading ? "Loading more…" : "Load more titles"}</button>}
      {nextOffset !== null && filter !== "all" && <p className="muted small">Filters apply to loaded titles. Load more to see additional matches.</p>}
      {removing && <Modal label="Remove saved title" onClose={() => { if (!busy) setRemoving(null); }}><h2>Remove {removing.title?.name || "this title"}?</h2><p className="muted">This removes it from your library. Your episode history, rating, and review are kept.</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="confirmation-actions"><button className="secondary" disabled={busy !== null} onClick={() => setRemoving(null)}>Cancel</button><button className="primary" disabled={busy !== null} onClick={() => remove(removing)}>{busy ? "Removing…" : "Remove title"}</button></div></Modal>}
    </>}
  </section>;
}
