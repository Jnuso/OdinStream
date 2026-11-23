import { useEffect, useRef, useState } from "react";
import Modal from "./Modal";
import Poster from "./Poster";
import PostCard from "./PostCard";
import Skeleton from "./Skeleton";
import { api } from "../data/api";
import { formatYear, type MediaType, type Post, type TitleSummary } from "../data/social";

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

export default function TitleDetails({ selection, token, viewerId, reloadKey = 0, onClose, onReview, onOpenProfile, onEdit, onOpenTitle, onSaved }: {
  selection: { media_type: MediaType; id: number }; token: string | null; viewerId?: string; reloadKey?: number;
  onClose: () => void; onReview?: (title: TitleSummary) => void;
  onOpenProfile?: (id: string) => void; onEdit?: (post: Post) => void;
  onOpenTitle: (type: MediaType, id: number) => void;
  onSaved?: () => void;
}) {
  const [detail, setDetail] = useState<Details | null>(null);
  const [detailError, setDetailError] = useState("");
  const [detailRetry, setDetailRetry] = useState(0);
  const [episodes, setEpisodes] = useState<Episode[] | null>(null);
  const [episodeError, setEpisodeError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [reviewPosts, setReviewPosts] = useState<Post[] | null>(null);
  const [reviewError, setReviewError] = useState("");
  const [libraryCheck, setLibraryCheck] = useState<LibraryCheck | null>(null);
  const [libraryRetry, setLibraryRetry] = useState(0);
  const detailRequest = useRef(0);
  const seasonRequest = useRef(0);
  const currentLibraryCheck = detail && libraryCheck?.token === token && libraryCheck.mediaType === detail.media_type && libraryCheck.id === detail.id ? libraryCheck : null;

  useEffect(() => {
    const request = ++detailRequest.current;
    api<Details>(`/api/catalog/${selection.media_type}/${selection.id}`)
      .then(data => { if (request === detailRequest.current) setDetail(data); })
      .catch(err => { if (request === detailRequest.current) setDetailError(err instanceof Error ? err.message : "Could not load title details."); });
    return () => { detailRequest.current += 1; seasonRequest.current += 1; };
  }, [selection.media_type, selection.id, token, detailRetry]);

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
      onSaved?.();
      if (request !== detailRequest.current) return;
      setSaveMessage("Added to your watchlist.");
      setLibraryCheck({ token, mediaType: detail.media_type, id: detail.id, status: "watchlist" });
    } catch (err) {
      if (request === detailRequest.current) setSaveMessage(err instanceof Error ? err.message : "Could not save title.");
    } finally {
      if (request === detailRequest.current) setSaving(false);
    }
  }

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

  return <Modal className="title-dialog" label={detail ? `${detail.name} details` : "Title details"} onClose={onClose}>
    {detailError ? <><h2>Couldn’t load this title</h2><p className="form-error" role="alert">{detailError}</p><button className="secondary" onClick={() => { setDetailError(""); setDetailRetry(value => value + 1); }}>Try again</button></>
      : !detail ? <Skeleton label="Loading title details…" variant="rows" count={1} />
      : <>
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
            </div>
          </div>
          <div className="title-detail-panels">
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
                    onOpenProfile={id => { onClose(); onOpenProfile?.(id); }}
                    onOpenTitle={onOpenTitle}
                    onEdit={() => {}} onDelete={() => {}} />
                ))}</div>}
            </section>
          </div>
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
      </>}
  </Modal>;
}
