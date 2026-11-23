import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../data/api";
import Poster from "./Poster";
import Modal from "./Modal";
import Skeleton from "./Skeleton";
import ShowProgress from "./ShowProgress";
import { cachedCatalog } from "../data/catalogCache";
import { createLibraryCache, fetchLibraryPage, libraryGroups, type LibraryGroup, type SavedEntry as Entry } from "../data/libraryCache";

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
  const libraryCache = useMemo(() => cache ?? createLibraryCache(token), [cache, token]);
  const [group, setGroup] = useState<LibraryGroup>("in-progress");
  const firstPage = libraryCache.pages[group];
  const [revision, setRevision] = useState(0);
  const [loadedGroup, setLoadedGroup] = useState<LibraryGroup | null>(firstPage.peek() ? group : null);
  const [actions, setActions] = useState<string | null>(null);
  const [entries, setItems] = useState<Entry[]>(() => firstPage.peek()?.items ?? []);
  const [titles, setTitles] = useState<Record<string, Title | null>>({});
  const [loading, setLoading] = useState(!!token && !firstPage.peek());
  const [nextOffset, setNextOffset] = useState<number | null>(() => firstPage.peek()?.next_offset ?? null);
  const pageRequest = useRef(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [removing, setRemoving] = useState<LibraryEntry | null>(null);

  useEffect(() => {
    if (!token) { setItems([]); setNextOffset(null); setLoading(false); return; }
    let active = true;
    setLoading(true); setError("");
    firstPage.load().then(data => {
      if (active) { setItems(data.items); setNextOffset(data.next_offset ?? null); setLoadedGroup(group); }
    }).catch(err => { if (active) setError(err instanceof Error ? err.message : "Could not load your library."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; pageRequest.current += 1; };
  }, [firstPage, token, version, group, revision]);

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
      const data = await fetchLibraryPage(token, group, nextOffset);
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
    try {
      await api(`/api/me/saved-titles/${entry.id}`, token, { method: "PATCH", body: JSON.stringify({ status }) });
      setItems(previous => previous.map(item => item.id === entry.id ? { ...item, status } : item));
      libraryCache.invalidate();
      setActions(null);
      setRevision(value => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update title.");
    }
    finally { setBusy(null); }
  }
  async function remove(entry: Entry) {
    if (!token || busy || loading) return;
    setBusy(entry.id); setError("");
    try {
      await api(`/api/me/saved-titles/${entry.id}`, token, { method: "DELETE" });
      libraryCache.invalidate();
      setActions(null);
      setRevision(value => value + 1);
      setItems(previous => previous.filter(item => item.id !== entry.id));
      setRemoving(null);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not remove title."); }
    finally { setBusy(null); }
  }

  const items: LibraryEntry[] = entries.map(entry => ({ ...entry, title: titles[catalogPath(entry)] ?? undefined }));
  const activeStatus = (status: string) => status === "watching" || status === "paused";
  const visible = loadedGroup !== group ? [] : items.filter(item =>
    group === "in-progress" ? activeStatus(item.status) :
      group === "watchlist" ? item.status === "watchlist" : ["watched", "completed", "dropped"].includes(item.status));
  const labels: Record<string, string> = { all: "All titles", watching: "Watching", watchlist: "Watchlist", watched: "Watched", paused: "Paused", dropped: "Dropped", completed: "Completed" };
  const emptyCopy = {
    "in-progress": ["No shows in progress", "Set a show to Watching from your Watchlist to track episodes."],
    watchlist: ["Your watchlist is empty", "Save a movie or show from Featured, Discover, or Search."],
    history: ["No viewing history yet", "Watched, completed and dropped titles will appear here."],
  }[group];
  return <section className="library-page"><div className="page-heading"><h1>My Library</h1></div>
    {!token ? <p>Sign in from Account to view your library.</p> : <>
      <div className="library-tabs" aria-label="Library views">{libraryGroups.map(([value, label]) =>
        <button key={value} aria-pressed={group === value} className={group === value ? "active" : ""}
          disabled={busy !== null} onClick={() => { setGroup(value); setActions(null); setExpanded(null); }}>{label}</button>)}</div>
      {error && <div role="alert"><p className="form-error">{error}</p>
        {loadedGroup !== group && <button className="secondary" onClick={() => setRevision(value => value + 1)}>Try again</button>}
      </div>}
      {(loading || loadedGroup !== group && !error) && visible.length === 0 && <Skeleton label="Loading library…" variant="rows" />}
      {!loading && !error && loadedGroup === group && visible.length === 0 && <div className="empty"><h2>{emptyCopy[0]}</h2><p>{emptyCopy[1]}</p></div>}
      <div className="post-list">{visible.map(item => <article className="post-card library-entry" key={item.id}>
        <button className="library-title" onClick={() => onOpenTitle?.(item.media_type, item.tmdb_id)} disabled={!onOpenTitle}>
          <Poster name={item.title?.name || "?"} posterPath={item.title?.poster_path ?? null} size="w185" />
          <span><strong>{item.title?.name || `${item.media_type === "tv" ? "TV show" : "Movie"} · TMDB ${item.tmdb_id}`}</strong>
          <small>{item.media_type === "tv" ? "TV show" : "Movie"} · {labels[item.status]}</small>
          {!item.title && <small>{titles[catalogPath(item)] === null ? "Title details are unavailable; your saved entry is intact." : "Loading title details…"}</small>}</span></button>
        {item.media_type === "tv" && <button className="secondary" aria-expanded={expanded === item.id} onClick={() => setExpanded(expanded === item.id ? null : item.id)}>Episode progress</button>}
        <button className="secondary library-actions-button" aria-expanded={actions === item.id}
          aria-label={`Actions for ${item.title?.name || item.tmdb_id}`}
          onClick={() => setActions(actions === item.id ? null : item.id)}>Actions</button>
        {actions === item.id && <div className="library-actions">
          <label className="library-status">Status
            <select aria-label={`Status for ${item.title?.name || item.tmdb_id}`} value={item.status}
              disabled={busy !== null || loading} onChange={event => void update(item, event.target.value)}>
              {statuses[item.media_type].map(status => <option key={status} value={status}>{labels[status]}</option>)}
            </select>
          </label>
          <button className="library-remove" disabled={busy !== null || loading} onClick={() => setRemoving(item)}>Remove</button>
        </div>}
        {item.media_type === "tv" && (activeStatus(item.status) || expanded === item.id) && (
          <ShowProgress entry={item} token={token} expanded={expanded === item.id} />
        )}
      </article>)}</div>
      {loadedGroup === group && nextOffset !== null && <button className="secondary" disabled={loading || busy !== null}
        onClick={() => void loadMore()}>{loading ? "Loading more…" : "Load more titles"}</button>}
      {removing && <Modal label="Remove saved title" onClose={() => { if (!busy) setRemoving(null); }}><h2>Remove {removing.title?.name || "this title"}?</h2><p className="muted">This removes it from your library. Your episode history, rating, and review are kept.</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="confirmation-actions"><button className="secondary" disabled={busy !== null} onClick={() => setRemoving(null)}>Cancel</button><button className="primary" disabled={busy !== null} onClick={() => remove(removing)}>{busy ? "Removing…" : "Remove title"}</button></div></Modal>}
    </>}
  </section>;
}
