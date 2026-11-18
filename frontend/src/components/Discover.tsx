import { useEffect, useState, type FormEvent } from "react";
import Modal from "./Modal";
import Poster from "./Poster";
import { api } from "../data/api";
import { fetchRecommendations, formatYear, type MediaType, type Recommendation } from "../data/social";

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

export default function Discover({
  token,
  focus,
  onFocusHandled,
}: {
  token: string | null;
  focus: { media_type: MediaType; id: number } | null;
  onFocusHandled: () => void;
}) {
  const [query, setQuery] = useState("");
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

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError("");
    setItems(null);
    try {
      const data = await api<{ items: Title[] }>(`/api/catalog/search?query=${encodeURIComponent(query.trim())}`);
      setItems(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed.");
    } finally {
      setLoading(false);
    }
  }

  async function openTitle(mediaType: MediaType, id: number) {
    setDetailLoading(true);
    setError("");
    setEpisodes(null);
    setEpisodeError("");
    setSaveMessage("");
    try {
      setDetail(await api<Details>(`/api/catalog/${mediaType}/${id}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load title details.");
    } finally {
      setDetailLoading(false);
    }
  }

  async function openSeason(season: number) {
    if (!detail) return;
    setEpisodes(null);
    setEpisodeError("");
    try {
      const data = await api<{ episodes: Episode[] }>(`/api/catalog/tv/${detail.id}/seasons/${season}`);
      setEpisodes(data.episodes);
    } catch (err) {
      setEpisodeError(err instanceof Error ? err.message : "Could not load episodes.");
    }
  }

  async function saveTitle() {
    if (!token || !detail) return;
    setSaving(true);
    setSaveMessage("");
    try {
      await api("/api/me/saved-titles", token, {
        method: "POST",
        body: JSON.stringify({ media_type: detail.media_type, tmdb_id: detail.id, status: "watchlist" }),
      });
      setSaveMessage("Added to your watchlist.");
    } catch (err) {
      setSaveMessage(err instanceof Error ? err.message : "Could not save title.");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!token) {
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

  return (
    <section>
      <div className="page-heading">
        <div>
          <h1>Discover</h1>
          <p>Search movies and shows and see where to watch in the United States.</p>
        </div>
      </div>
      {token && (
        <section className="recommendations" aria-label="Recommended titles">
          <div className="section-heading">
            <h2>Recommended for you</h2>
            <p className="muted small">
              {recommendedBasis === "genres"
                ? "Based on the genres you saved in your account."
                : "Add favorite genres in Account for personal picks; these are popular titles."}
            </p>
          </div>
          {recommendedError ? (
            <p className="muted">{recommendedError}</p>
          ) : recommended === null ? (
            <p role="status">Loading recommendations…</p>
          ) : recommended.length === 0 ? (
            <p className="muted">No recommendations yet. Save a few genres in Account.</p>
          ) : (
            <div className="discover-results">
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
      {error && <p role="alert" className="form-error">{error}</p>}
      {(loading || detailLoading) && <p role="status">Loading…</p>}
      {items && items.length === 0 && <p className="muted">No titles found. Try another search.</p>}
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
      <p className="discover-attribution">
        Movie and TV data provided by{" "}
        <a href="https://www.themoviedb.org/" target="_blank" rel="noreferrer">TMDB</a>. Watch availability
        provided by <a href="https://www.justwatch.com/" target="_blank" rel="noreferrer">JustWatch</a>. This
        product uses the TMDB API but is not endorsed or certified by TMDB.
      </p>
      {detail && (
        <Modal
          label={`${detail.name} details`}
          onClose={() => {
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
              <button className="primary" disabled={saving} onClick={saveTitle}>
                Add to watchlist
              </button>
            ) : (
              <p>Sign in from Account to save this title.</p>
            )}
            {saveMessage && <p role="status">{saveMessage}</p>}
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
