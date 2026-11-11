import { useState, type FormEvent } from "react";
import { catalog, type Post } from "../data/mock";
import Modal from "./Modal";
import Poster from "./Poster";

export default function PostComposer({
  post,
  onClose,
  onSave,
}: {
  post?: Post;
  onClose: () => void;
  onSave: (values: Pick<Post, "titleId" | "rating" | "review">) => void;
}) {
  const [query, setQuery] = useState("");
  const [titleId, setTitleId] = useState(post?.titleId ?? 0);
  const [rating, setRating] = useState(post?.rating ?? 0);
  const [review, setReview] = useState(post?.review ?? "");
  const [error, setError] = useState("");
  const title = catalog.find((item) => item.id === titleId);
  const matches = catalog.filter((item) =>
    item.name.toLowerCase().includes(query.toLowerCase()),
  );
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!title || !rating) {
      setError("Choose a title and a rating to share your post.");
      return;
    }
    onSave({ titleId, rating, review: review.trim() });
  }
  return (
    <Modal label={post ? "Edit post" : "New post"} onClose={onClose}>
      <span className="eyebrow">YOUR TAKE BELONGS HERE</span>
      <h2>{post ? "A second take." : "What stayed with you?"}</h2>
      <p className="muted">A great story deserves a conversation.</p>
      <form onSubmit={submit} className="composer">
        <label htmlFor="title-search">Pick a movie or show</label>
        <input
          id="title-search"
          type="search"
          placeholder="Search the sample catalog…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="title-choices" aria-label="Sample titles">
          {matches.map((item) => (
            <button
              type="button"
              key={item.id}
              aria-pressed={titleId === item.id}
              className={titleId === item.id ? "chosen" : ""}
              onClick={() => {
                setTitleId(item.id);
                setError("");
              }}
            >
              <strong>{item.name}</strong>
              <small>
                {item.kind} · {item.year}
              </small>
              <span>{titleId === item.id ? "✓" : "+"}</span>
            </button>
          ))}
          {!matches.length && (
            <p className="muted">No sample titles match. Try another search.</p>
          )}
        </div>
        {title && (
          <div className="selected-title">
            <Poster title={title} />
            <div>
              <strong>{title.name}</strong>
              <p>
                {title.year} · {title.genre}
              </p>
            </div>
          </div>
        )}
        <fieldset className="rating-input">
          <legend>
            Your rating <span>(required)</span>
          </legend>
          <div role="radiogroup" aria-label="Your rating">
            {[1, 2, 3, 4, 5].map((value) => (
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
                ★
              </button>
            ))}
          </div>
          <span className="small muted">
            {rating ? `${rating} out of 5 stars` : "Choose 1–5 stars"}
          </span>
        </fieldset>
        <label htmlFor="review">
          Your review <span className="muted">(optional)</span>
        </label>
        <textarea
          id="review"
          maxLength={1000}
          rows={4}
          placeholder="The scene, the feeling, the reason you’d recommend it…"
          value={review}
          onChange={(event) => setReview(event.target.value)}
        />
        <span className="character-count">{review.length}/1000</span>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="composer-footer">
          <p>
            Public in this local demo.
            <br />
            No post is sent to a server.
          </p>
          <button type="submit" className="primary">
            {post ? "Save changes" : "Publish post"} <span>↗</span>
          </button>
        </div>
      </form>
    </Modal>
  );
}
