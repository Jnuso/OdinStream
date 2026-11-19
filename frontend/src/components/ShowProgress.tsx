import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../data/api";
import Skeleton from "./Skeleton";
import { cachedCatalog } from "../data/catalogCache";

type Watched = { season_number: number; episode_number: number };
type Episode = { episode_number: number; name: string };
type Season = { season_number: number; name: string; episode_count: number };
type Progress = { items: Watched[]; last_watched: Watched | null };
type Entry = { id: string; tmdb_id: number; status?: string; title?: { seasons: Season[] } };

export default function ShowProgress({ entry, token, expanded }: { entry: Entry; token: string; expanded: boolean }) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [season, setSeason] = useState<number | null>(null);
  const [episodes, setEpisodes] = useState<Episode[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [next, setNext] = useState<{ label: string; detail: string } | null>(null);
  const mounted = useRef(true);
  const seasonRequest = useRef(0);
  const cache = useRef(new Map<number, Episode[]>());
  const inFlight = useRef(new Map<number, Promise<Episode[]>>());

  const getEpisodes = useCallback((number: number) => {
    const cached = cache.current.get(number);
    if (cached) return Promise.resolve(cached);
    const pending = inFlight.current.get(number);
    if (pending) return pending;
    const request = cachedCatalog<{ episodes: Episode[] }>(`/api/catalog/tv/${entry.tmdb_id}/seasons/${number}`)
      .then(data => {
        if (!Array.isArray(data.episodes)) throw new Error("Episode information is unavailable.");
        cache.current.set(number, data.episodes);
        return data.episodes;
      }).finally(() => { inFlight.current.delete(number); });
    inFlight.current.set(number, request);
    return request;
  }, [entry.tmdb_id]);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    api<Progress>(`/api/me/saved-titles/${entry.id}/episodes`, token)
      .then(data => { if (active) setProgress(data); })
      .catch(err => { if (active) { setError(err instanceof Error ? err.message : "Could not load progress."); setNext({ label: "Next episode unavailable", detail: "Episode progress could not be loaded." }); } });
    return () => { active = false; mounted.current = false; };
  }, [entry.id, token]);

  useEffect(() => {
    if (!progress || busy) return;
    let active = true;
    const last = progress.last_watched;
    const prefix = last ? `Last watched: S${last.season_number} E${last.episode_number}. ` : "";
    const seasons = entry.title?.seasons ?? [];
    const unavailable = (reason: string) => {
      if (active) setNext({ label: "Next episode unavailable", detail: prefix + reason });
    };
    if (progress.items.length && !last) {
      unavailable("Last watched episode is unavailable.");
      return;
    }
    if (!seasons.length || (last && !seasons.some(item => item.season_number === last.season_number))) {
      unavailable("Next episode unavailable because season metadata is missing.");
      return;
    }
    // New viewers start with the main seasons; an explicit saved special still resumes season zero.
    const start = last?.season_number ?? (seasons.some(item => item.season_number > 0) ? 1 : 0);
    const candidates = seasons.filter(item => Number.isInteger(item.season_number) && item.season_number >= start)
      .sort((a, b) => a.season_number - b.season_number);
    void (async () => {
      try {
        for (const item of candidates) {
          const data = await getEpisodes(item.season_number);
          if (!active) return;
          if (!data.length || data.some(ep => !Number.isInteger(ep.episode_number) || ep.episode_number <= 0)) throw new Error("Missing episode metadata");
          if (last && item.season_number === last.season_number && !data.some(ep => ep.episode_number === last.episode_number)) throw new Error("Missing last watched episode");
          const following = [...data].sort((a, b) => a.episode_number - b.episode_number)
            .find(ep => !last || item.season_number > last.season_number || ep.episode_number > last.episode_number);
          if (following) {
            const label = `Next: S${item.season_number} E${following.episode_number}${following.name ? ` · ${following.name}` : ""}`;
            setNext({ label, detail: prefix + label });
            return;
          }
        }
        if (active) setNext({ label: "No next episode listed", detail: prefix + "No following episode is currently listed." });
      } catch { unavailable("Next episode is unavailable while episode metadata is missing."); }
    })();
    return () => { active = false; };
  }, [progress, busy, entry.title, getEpisodes]);

  async function openSeason(number: number) {
    if (busy || (season === number && episodes !== null)) return;
    const request = ++seasonRequest.current;
    const cached = cache.current.get(number);
    setSeason(number); setError(""); setEpisodes(cached ?? null); setLoading(!cached);
    try {
      const data = await getEpisodes(number);
      if (mounted.current && request === seasonRequest.current) setEpisodes(data);
    } catch (err) {
      if (mounted.current && request === seasonRequest.current) setError(err instanceof Error ? err.message : "Could not load episodes.");
    } finally { if (mounted.current && request === seasonRequest.current) setLoading(false); }
  }

  async function change(method: "PUT" | "DELETE", episode?: number) {
    if (season === null || !progress || busy) return;
    const previous = progress;
    let saved = false;
    setBusy(true); setError("");
    const numbers = episode === undefined ? (episodes ?? []).map(ep => ep.episode_number) : [episode];
    setProgress({ ...progress, items: method === "PUT"
      ? [...progress.items.filter(item => item.season_number !== season || !numbers.includes(item.episode_number)), ...numbers.map(episode_number => ({ season_number: season, episode_number }))]
      : progress.items.filter(item => item.season_number !== season || (episode !== undefined && item.episode_number !== episode)) });
    try {
      const path = `/api/me/saved-titles/${entry.id}/seasons/${season}/episodes${episode === undefined ? "" : `/${episode}`}`;
      await api(path, token, { method });
      saved = true;
      const data = await api<Progress>(`/api/me/saved-titles/${entry.id}/episodes`, token);
      if (mounted.current) setProgress(data);
    } catch (err) {
      if (mounted.current) {
        if (!saved) setProgress(previous);
        else setProgress(value => value ? { ...value, last_watched: null } : value);
        setError(err instanceof Error ? err.message : "Could not update progress.");
      }
    } finally { if (mounted.current) setBusy(false); }
  }

  const seasons = entry.title?.seasons ?? [];
  const watched = progress?.items ?? [];
  const missingSeasons = [...new Set(watched.map(item => item.season_number))]
    .filter(number => !seasons.some(item => item.season_number === number))
    .map(number => ({ season_number: number, name: `Season ${number} (saved progress)`, episode_count: 0 }));
  const availableSeasons = [...seasons, ...missingSeasons].sort((a, b) => a.season_number - b.season_number);
  const watchedNumbers = new Set(watched.filter(item => item.season_number === season).map(item => item.episode_number));
  const availableEpisodes = new Map((episodes ?? []).map(ep => [ep.episode_number, { ...ep, missing: false }]));
  for (const number of watchedNumbers) {
    if (!availableEpisodes.has(number)) availableEpisodes.set(number, { episode_number: number, name: "", missing: true });
  }
  const orderedEpisodes = [...availableEpisodes.values()].sort((a, b) => a.episode_number - b.episode_number);

  if (entry.status === "completed" && !expanded) return null;

  return <div className="show-progress">
    {entry.status !== "completed" && <p className="library-next">{next?.label ?? <span className="next-placeholder" aria-label="Finding next episode" />}</p>}
    {expanded && <div className="episode-progress" aria-busy={busy}>
      <h3>Episode progress</h3>
      {progress && <p>{watched.length} episode{watched.length === 1 ? "" : "s"} marked watched. {next?.detail}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {!seasons.length && <p className="muted">Season information is unavailable. Your saved progress is intact.</p>}
      {availableSeasons.map(item => <button className="secondary" key={item.season_number} disabled={busy} aria-pressed={season === item.season_number} onClick={() => void openSeason(item.season_number)}>{item.name || `Season ${item.season_number}`}</button>)}
      {loading && <Skeleton label="Loading episodes…" variant="episodes" />}
      {season !== null && <div>
        {episodes && <><p>Season {season} · {episodes.filter(ep => watchedNumbers.has(ep.episode_number)).length} of {episodes.length} listed episodes watched</p>
          <button className="secondary" disabled={busy || !progress || !episodes.length} onClick={() => void change("PUT")}>Mark season watched</button></>}
        <button className="secondary" disabled={busy || !progress} onClick={() => void change("DELETE")}>Unmark season {season}</button>
        {orderedEpisodes.length > 0 ? <ol>{orderedEpisodes.map(ep => {
          const selected = watchedNumbers.has(ep.episode_number);
          return <li key={ep.episode_number}><label><input type="checkbox" checked={selected} disabled={!progress} aria-disabled={busy} onChange={() => { if (!busy) void change(selected ? "DELETE" : "PUT", ep.episode_number); }} /> {ep.name || `Episode ${ep.episode_number}`} (E{ep.episode_number}){ep.missing && " · saved progress, details unavailable"}</label></li>;
        })}</ol> : episodes && <p>No episode information available.</p>}
      </div>}
    </div>}
  </div>;
}
