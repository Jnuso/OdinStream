import { useEffect, useState } from "react";
import { api } from "../data/api";
import Poster from "./Poster";
import Modal from "./Modal";
import Skeleton from "./Skeleton";
import ShowProgress from "./ShowProgress";
import { cachedCatalog } from "../data/catalogCache";

type Entry = { id: string; media_type: "movie" | "tv"; tmdb_id: number; status: string };
type Season = { season_number: number; name: string; episode_count: number };
type Title = { name: string; poster_path: string | null; seasons: Season[] };
type LibraryEntry = Entry & { title?: Title };


const statuses = { movie: ["watchlist", "watched"], tv: ["watchlist", "watching", "completed", "paused", "dropped"] };

export default function Library({ token, onOpenTitle }: { token: string | null; onOpenTitle?: (type: "movie" | "tv", id: number) => void }) {
  const [items, setItems] = useState<LibraryEntry[]>([]);
  const [loading, setLoading] = useState(!!token);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [removing, setRemoving] = useState<LibraryEntry | null>(null);

  useEffect(() => {
    if (!token) { setItems([]); return; }
    let active = true;
    setLoading(true); setError(""); setItems([]);
    api<{ items: Entry[]; next_offset?: number | null }>("/api/me/saved-titles", token).then(async data => {
      const items = await Promise.all(data.items.map(async entry => {
        try { return { ...entry, title: await cachedCatalog<Title>(`/api/catalog/${entry.media_type}/${entry.tmdb_id}`) }; }
        catch { return entry; }
      }));
      if (active) { setItems(items); setNextOffset(data.next_offset ?? null); }
    }).catch(err => { if (active) setError(err instanceof Error ? err.message : "Could not load your library."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  async function loadMore() {
    if (!token || nextOffset === null) return;
    setLoading(true); setError("");
    try {
      const data = await api<{ items: Entry[]; next_offset: number | null }>(`/api/me/saved-titles?offset=${nextOffset}`, token);
      const enriched = await Promise.all(data.items.map(async entry => {
        try { return { ...entry, title: await cachedCatalog<Title>(`/api/catalog/${entry.media_type}/${entry.tmdb_id}`) }; }
        catch { return entry; }
      }));
      setItems(previous => [...previous, ...enriched]); setNextOffset(data.next_offset);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not load more titles."); }
    finally { setLoading(false); }
  }

  async function update(entry: Entry, status: string) {
    if (!token || busy) return;
    setBusy(entry.id); setError("");
    setItems(previous => previous.map(item => item.id === entry.id ? { ...item, status } : item));
    try {
      await api(`/api/me/saved-titles/${entry.id}`, token, { method: "PATCH", body: JSON.stringify({ status }) });
    } catch (err) {
      setItems(previous => previous.map(item => item.id === entry.id ? { ...item, status: entry.status } : item));
      setError(err instanceof Error ? err.message : "Could not update title.");
    }
    finally { setBusy(null); }
  }
  async function remove(entry: Entry) {
    if (!token) return;
    setBusy(entry.id); setError("");
    try {
      await api(`/api/me/saved-titles/${entry.id}`, token, { method: "DELETE" });
      setItems(previous => previous.filter(item => item.id !== entry.id));
      setRemoving(null);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not remove title."); }
    finally { setBusy(null); }
  }

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
          {!item.title && <small>Title details are unavailable; your saved entry is intact.</small>}</span></button>
        <label className="library-status"><span className="sr-only">Status for {item.title?.name || item.tmdb_id}</span><select aria-label={`Status for ${item.title?.name || item.tmdb_id}`} value={item.status} aria-disabled={busy !== null} onChange={event => { if (!busy) void update(item, event.target.value); }}>
          {statuses[item.media_type].map(status => <option key={status} value={status}>{labels[status]}</option>)}</select></label>
        {item.media_type === "tv" && <button className="secondary" aria-expanded={expanded === item.id} onClick={() => setExpanded(expanded === item.id ? null : item.id)}>Episode progress</button>}
        <button className="library-remove" aria-disabled={busy !== null} onClick={() => { if (!busy) setRemoving(item); }}>Remove</button>
        {item.media_type === "tv" && (item.status !== "completed" || expanded === item.id) && (
          <ShowProgress entry={item} token={token} expanded={expanded === item.id} />
        )}
      </article>)}</div>
      {nextOffset !== null && <button className="secondary" disabled={loading} onClick={() => void loadMore()}>{loading ? "Loading more…" : "Load more titles"}</button>}
      {nextOffset !== null && filter !== "all" && <p className="muted small">Filters apply to loaded titles. Load more to see additional matches.</p>}
      {removing && <Modal label="Remove saved title" onClose={() => { if (!busy) setRemoving(null); }}><h2>Remove {removing.title?.name || "this title"}?</h2><p className="muted">This removes it from your library. Your episode history, rating, and review are kept.</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="confirmation-actions"><button className="secondary" disabled={busy !== null} onClick={() => setRemoving(null)}>Cancel</button><button className="primary" disabled={busy !== null} onClick={() => remove(removing)}>{busy ? "Removing…" : "Remove title"}</button></div></Modal>}
    </>}
  </section>;
}
