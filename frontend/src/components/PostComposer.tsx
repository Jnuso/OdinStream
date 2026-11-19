import { useState, type FormEvent } from "react";
import { api } from "../data/api";
import { editPost, formatYear, publishPost, type MediaType, type Post, type TitleSummary } from "../data/social";
import Modal from "./Modal";
import Poster from "./Poster";

type Choice = { media_type: MediaType; id: number; name: string; poster_path: string | null; release_date: string | null };

export default function PostComposer({
  token,
  post,
  onClose,
  onSaved,
}: {
  token: string;
  post?: Post;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TitleSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [choice, setChoice] = useState<Choice | null>(
    post
      ? {
          media_type: post.media_type,
          id: post.tmdb_id,
          name: post.title_name,
          poster_path: post.poster_path,
          release_date: post.release_date,
        }
      : null,
  );
  const [rating, setRating] = useState(post?.rating ?? 0);
  const [review, setReview] = useState(post?.review ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setSearchError("");
    setResults(null);
    try {
      const data = await api<{ items: TitleSummary[] }>(
        `/api/catalog/search?query=${encodeURIComponent(query.trim())}`,
      );
      setResults(data.items.slice(0, 8));
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "The search failed.");
    } finally {
      setSearching(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!choice || !rating) {
      setError("Choose a title and a rating to share your post.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const values = { rating, review: review.trim() || null };
      if (post) {
        await editPost(token, post.id, values);
        onSaved("Your post has been updated.");
      } else {
        await publishPost(token, { media_type: choice.media_type, id: choice.id }, values);
        onSaved("Your post is live in the feed.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "The post could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal label={post ? "Edit post" : "New post"} onClose={onClose}>
      <h2>{post ? "Edit post" : "New post"}</h2>
      <p className="muted">Choose a title, add a rating, and optionally write a review.</p>
      <form onSubmit={submit} className="composer">
        {!post && (
          <>
            <label htmlFor="title-search">Search movies and shows</label>
            <div className="composer-search">
              <input
                id="title-search"
                type="search"
                placeholder="Movie or show title"
                value={query}
                maxLength={200}
                onChange={(event) => setQuery(event.target.value)}
              />
              <button type="button" className="secondary" onClick={search} disabled={searching || !query.trim()}>
                {searching ? "Searching…" : "Search"}
              </button>
            </div>
            {searchError && (
              <p className="form-error" role="alert">
                {searchError}
              </p>
            )}
            <div className="title-choices" aria-label="Search results">
              {results?.map((item) => (
                <button
                  type="button"
                  key={`${item.media_type}-${item.id}`}
                  aria-pressed={choice?.id === item.id && choice?.media_type === item.media_type}
                  className={choice?.id === item.id && choice?.media_type === item.media_type ? "chosen" : ""}
                  onClick={() => {
                    setChoice({
                      media_type: item.media_type,
                      id: item.id,
                      name: item.name,
                      poster_path: item.poster_path,
                      release_date: item.release_date,
                    });
                    setError("");
                  }}
                >
                  <strong>{item.name}</strong>
                  <small>
                    {item.media_type === "tv" ? "TV show" : "Movie"}
                    {formatYear(item.release_date) ? ` · ${formatYear(item.release_date)}` : ""}
                  </small>
                  <span>{choice?.id === item.id && choice?.media_type === item.media_type ? "✓" : "+"}</span>
                </button>
              ))}
              {results?.length === 0 && <p className="muted">No titles found. Try another search.</p>}
            </div>
          </>
        )}
        {choice && (
          <div className="selected-title">
            <Poster name={choice.name} posterPath={choice.poster_path} size="w185" />
            <div>
              <strong>{choice.name}</strong>
              <p>
                {choice.media_type === "tv" ? "TV show" : "Movie"}
                {formatYear(choice.release_date) ? ` · ${formatYear(choice.release_date)}` : ""}
              </p>
            </div>
          </div>
        )}
        <fieldset className="rating-input">
          <legend>
            Your rating <span>(required)</span>
          </legend>
          <div role="radiogroup" aria-label="Your rating">
            {[0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map((value) => (
              <button
                type="button"
                role="radio"
                key={value}
                aria-checked={rating === value}
                aria-label={`${value} ${value === 1 ? "star" : "stars"}`}
                className={value <= rating ? "filled" : ""}
                onClick={() => {
                  setRating(value);
                  setError("");
                }}
              >
                {value}
              </button>
            ))}
          </div>
          <span className="small muted">{rating ? `${rating} out of 5 stars` : "Choose 0.5–5 stars"}</span>
        </fieldset>
        <label htmlFor="review">
          Your review <span className="muted">(optional)</span>
        </label>
        <textarea
          id="review"
          maxLength={2000}
          rows={4}
          placeholder="Write your review…"
          value={review}
          onChange={(event) => setReview(event.target.value)}
        />
        <span className="character-count">{review.length}/2000</span>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="composer-footer">
          <p>Your profile visibility determines who can see this post. You can edit or delete it later.</p>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Saving…" : post ? "Save changes" : "Publish post"} <span>↗</span>
          </button>
        </div>
      </form>
    </Modal>
  );
}
