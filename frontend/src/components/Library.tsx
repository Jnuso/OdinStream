import { useEffect, useState } from "react";
import { api } from "../data/api";

type Entry = { id: string; media_type: "movie" | "tv"; tmdb_id: number; status: string };
type Season = { season_number: number; name: string; episode_count: number };
type Title = { name: string; poster_path: string | null; seasons: Season[] };
type LibraryEntry = Entry & { title?: Title };
type Watched = { season_number: number; episode_number: number };
type Episode = { episode_number: number; name: string };
const statuses = { movie: ["watchlist", "watched"], tv: ["watchlist", "watching", "completed", "paused", "dropped"] };

function EpisodeProgress({ entry, token }: { entry: LibraryEntry; token: string }) {
  const [watched, setWatched] = useState<Watched[] | null>(null);
  const [lastWatched, setLastWatched] = useState<Watched | null>(null);
  const [season, setSeason] = useState<number | null>(null);
  const [episodes, setEpisodes] = useState<Episode[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [next, setNext] = useState("");

  useEffect(() => {
    let active = true;
    api<{ items: Watched[]; last_watched: Watched | null }>(`/api/me/saved-titles/${entry.id}/episodes`, token)
      .then(data => { if (active) { setWatched(data.items); setLastWatched(data.last_watched); } })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : "Could not load progress."); });
    return () => { active = false; };
  }, [entry.id, token]);

  useEffect(() => {
    let active = true;
    setNext("");
    if (!watched?.length) { setNext("No episodes marked watched yet."); return; }
    const last = lastWatched;
    if (!last) { setNext("Last watched episode is unavailable."); return; }
    const seasons = entry.title?.seasons;
    if (!seasons || !seasons.some(item => item.season_number === last.season_number)) {
      setNext(`Last watched: S${last.season_number} E${last.episode_number}. Next episode unavailable because season metadata is missing.`);
      return;
    }
    const candidates = seasons.filter(item => Number.isInteger(item.season_number) && item.season_number >= last.season_number)
      .sort((a, b) => a.season_number - b.season_number);
    (async () => {
      try {
        for (const item of candidates) {
          const data = await api<{ episodes: Episode[] }>(`/api/catalog/tv/${entry.tmdb_id}/seasons/${item.season_number}`);
          if (!Array.isArray(data.episodes) || data.episodes.length === 0 || data.episodes.some(ep => !Number.isInteger(ep.episode_number) || ep.episode_number <= 0)) {
            throw new Error("Missing episode metadata");
          }
          const ordered = [...data.episodes].sort((a, b) => a.episode_number - b.episode_number);
          if (item.season_number === last.season_number && !ordered.some(ep => ep.episode_number === last.episode_number)) {
            throw new Error("Missing last watched episode");
          }
          const following = ordered.find(ep => item.season_number > last.season_number || ep.episode_number > last.episode_number);
          if (following) {
            if (active) setNext(`Last watched: S${last.season_number} E${last.episode_number}. Next: S${item.season_number} E${following.episode_number}${following.name ? ` · ${following.name}` : ""}`);
            return;
          }
        }
        if (active) setNext(`Last watched: S${last.season_number} E${last.episode_number}. No following episode is currently listed.`);
      } catch {
        if (active) setNext(`Last watched: S${last.season_number} E${last.episode_number}. Next episode is unavailable while episode metadata is missing.`);
      }
    })();
    return () => { active = false; };
  }, [watched, lastWatched, entry.title, entry.tmdb_id]);

  async function openSeason(number: number) {
    setSeason(number); setEpisodes(null); setError(""); setLoading(true);
    try {
      const data = await api<{ episodes: Episode[] }>(`/api/catalog/tv/${entry.tmdb_id}/seasons/${number}`);
      if (!Array.isArray(data.episodes)) throw new Error("Episode information is unavailable.");
      setEpisodes(data.episodes);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not load episodes."); }
    finally { setLoading(false); }
  }
  async function change(method: "PUT" | "DELETE", episode?: number) {
    if (season === null) return;
    setBusy(true); setError("");
    try {
      const path = `/api/me/saved-titles/${entry.id}/seasons/${season}/episodes${episode === undefined ? "" : `/${episode}`}`;
      await api(path, token, { method });
      const data = await api<{ items: Watched[]; last_watched: Watched | null }>(`/api/me/saved-titles/${entry.id}/episodes`, token);
      setWatched(data.items); setLastWatched(data.last_watched);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not update progress."); }
    finally { setBusy(false); }
  }
  const seasons = entry.title?.seasons ?? [];
  const missingSeasons = [...new Set((watched ?? []).map(item => item.season_number))]
    .filter(number => !seasons.some(item => item.season_number === number))
    .map(number => ({ season_number: number, name: `Season ${number} (saved progress)`, episode_count: 0 }));
  const availableSeasons = [...seasons, ...missingSeasons].sort((a, b) => a.season_number - b.season_number);
  const watchedNumbers = new Set((watched ?? []).filter(item => item.season_number === season).map(item => item.episode_number));
  const availableEpisodes = new Map((episodes ?? []).map(ep => [ep.episode_number, { ...ep, missing: false }]));
  for (const number of watchedNumbers) {
    if (!availableEpisodes.has(number)) availableEpisodes.set(number, { episode_number: number, name: "", missing: true });
  }
  const orderedEpisodes = [...availableEpisodes.values()].sort((a, b) => a.episode_number - b.episode_number);
  return <div className="episode-progress">
    <h3>Episode progress</h3>
    {watched && <p>{watched.length} episode{watched.length === 1 ? "" : "s"} marked watched. {next || "Finding the next episode…"}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {!seasons.length && <p className="muted">Season information is unavailable. Your saved progress is intact.</p>}
    {availableSeasons.map(item => <button className="secondary" key={item.season_number} disabled={loading || busy} onClick={() => openSeason(item.season_number)}>{item.name || `Season ${item.season_number}`}</button>)}
    {loading && <p role="status">Loading episodes…</p>}
    {season !== null && <div>
      {episodes && <><p>Season {season} · {episodes.filter(ep => watchedNumbers.has(ep.episode_number)).length} of {episodes.length} listed episodes watched</p>
        <button className="secondary" disabled={busy || !watched || !episodes.length} onClick={() => change("PUT")}>Mark season watched</button></>}
      <button className="secondary" disabled={busy || !watched} onClick={() => change("DELETE")}>Unmark season {season}</button>
      {orderedEpisodes.length > 0 ? <ol>{orderedEpisodes.map(ep => {
        const selected = watchedNumbers.has(ep.episode_number);
        return <li key={ep.episode_number}><label><input type="checkbox" checked={selected} disabled={busy || !watched} onChange={() => change(selected ? "DELETE" : "PUT", ep.episode_number)} /> {ep.name || `Episode ${ep.episode_number}`} (E{ep.episode_number}){ep.missing && " · saved progress, details unavailable"}</label></li>;
      })}</ol> : episodes && <p>No episode information available.</p>}
    </div>}
  </div>;
}

export default function Library({ token }: { token: string | null }) {
  const [items, setItems] = useState<LibraryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setItems([]); return; }
    let active = true;
    setLoading(true); setError(""); setItems([]);
    api<{ items: Entry[]; next_offset?: number | null }>("/api/me/saved-titles", token).then(async data => {
      const items = await Promise.all(data.items.map(async entry => {
        try { return { ...entry, title: await api<Title>(`/api/catalog/${entry.media_type}/${entry.tmdb_id}`) }; }
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
        try { return { ...entry, title: await api<Title>(`/api/catalog/${entry.media_type}/${entry.tmdb_id}`) }; }
        catch { return entry; }
      }));
      setItems(previous => [...previous, ...enriched]); setNextOffset(data.next_offset);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not load more titles."); }
    finally { setLoading(false); }
  }

  async function update(entry: Entry, status: string) {
    if (!token) return;
    setBusy(entry.id); setError("");
    try {
      await api(`/api/me/saved-titles/${entry.id}`, token, { method: "PATCH", body: JSON.stringify({ status }) });
      setItems(previous => previous.map(item => item.id === entry.id ? { ...item, status } : item));
    } catch (err) { setError(err instanceof Error ? err.message : "Could not update title."); }
    finally { setBusy(null); }
  }
  async function remove(entry: Entry) {
    if (!token) return;
    setBusy(entry.id); setError("");
    try {
      await api(`/api/me/saved-titles/${entry.id}`, token, { method: "DELETE" });
      setItems(previous => previous.filter(item => item.id !== entry.id));
    } catch (err) { setError(err instanceof Error ? err.message : "Could not remove title."); }
    finally { setBusy(null); }
  }

  return <section><div className="page-heading"><div><h1>My Library</h1><p>Your saved movies and shows.</p></div></div>
    {!token ? <p>Sign in from Account to view your library.</p> : <>
      {error && <p className="form-error" role="alert">{error}</p>}{loading && <p role="status">Loading library…</p>}
      {!loading && !error && items.length === 0 && <p>No saved titles yet. Find one in Discover.</p>}
      <div className="post-list">{items.map(item => <article className="post-card library-entry" key={item.id}>
        <div><strong>{item.title?.name || `${item.media_type === "tv" ? "TV show" : "Movie"} · TMDB ${item.tmdb_id}`}</strong>
          {!item.title && <p className="muted">Title details are unavailable; your saved entry is intact.</p>}</div>
        <label>Status <select value={item.status} disabled={busy !== null} onChange={event => update(item, event.target.value)}>
          {statuses[item.media_type].map(status => <option key={status} value={status}>{status}</option>)}</select></label>
        {item.media_type === "tv" && <button className="secondary" disabled={busy !== null} aria-expanded={expanded === item.id} onClick={() => setExpanded(expanded === item.id ? null : item.id)}>Episode progress</button>}
        <button className="secondary" disabled={busy !== null} onClick={() => remove(item)}>Remove</button>
        {expanded === item.id && <EpisodeProgress entry={item} token={token} />}
      </article>)}</div>
      {nextOffset !== null && <button className="secondary" disabled={loading} onClick={() => void loadMore()}>Load more titles</button>}
    </>}
  </section>;
}
