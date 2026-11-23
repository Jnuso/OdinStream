import { useEffect, useState } from "react";
import { avatarColor, formatYear, initials, type Post } from "../data/social";
import { cachedCatalog } from "../data/catalogCache";
import Poster from "./Poster";

export default function PostCard({
  post,
  isOwn,
  onOpenProfile,
  onOpenTitle,
  onEdit,
  onDelete,
  showProfileLink = true,
}: {
  post: Post;
  isOwn: boolean;
  onOpenProfile: (id: string) => void;
  onOpenTitle: (mediaType: Post["media_type"], tmdbId: number) => void;
  onEdit: (post: Post) => void;
  onDelete: (post: Post) => void;
  showProfileLink?: boolean;
}) {
  const year = formatYear(post.release_date);
  const catalogPath = `/api/catalog/${post.media_type}/${post.tmdb_id}`;
  const [catalogPoster, setCatalogPoster] = useState<{ path: string; posterPath: string } | null>(null);
  const posterPath = post.poster_path || (catalogPoster?.path === catalogPath ? catalogPoster.posterPath : null);

  useEffect(() => {
    if (post.poster_path) return;
    let active = true;
    cachedCatalog<{ poster_path: string | null }>(catalogPath)
      .then(title => {
        if (active && title.poster_path) setCatalogPoster({ path: catalogPath, posterPath: title.poster_path });
      })
      .catch(() => {});
    return () => { active = false; };
  }, [catalogPath, post.poster_path]);

  return (
    <article className="post-card" aria-label={`${post.author.display_name} on ${post.title_name}`}>
      <div className="post-author">
        <button className="author-link" onClick={() => onOpenProfile(post.author.id)}>
          <span className={`avatar ${avatarColor(post.author.id)}`}>{initials(post.author.display_name)}</span>
          <span>
            <strong>{post.author.display_name}</strong>
            <small>@{post.author.handle}</small>
          </span>
        </button>
        <time dateTime={post.created_at}>
          {new Date(post.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </time>
      </div>
      <div className="post-content">
        <button
          className="poster-button"
          aria-label={`Open ${post.title_name} details`}
          onClick={() => onOpenTitle(post.media_type, post.tmdb_id)}
        >
          <Poster name={post.title_name} posterPath={posterPath} size="w185" />
        </button>
        <div className="post-review">
          <span className="eyebrow">
            {post.media_type === "tv" ? "TV show" : "Movie"}
            {year ? ` · ${year}` : ""}
          </span>
          <button className="title-link" onClick={() => onOpenTitle(post.media_type, post.tmdb_id)}>
            {post.title_name} <span>↗</span>
          </button>
          <span className="stars" aria-label={`${post.rating} out of 5 stars`}>
            <span className="star-glyphs" aria-hidden="true">★★★★★<span style={{ width: `${post.rating / 5 * 100}%` }}>★★★★★</span></span>
            <span className="rating-value">{post.rating.toFixed(1)} / 5</span>
          </span>
          {post.review ? (
            <p className="review-text">{post.review}</p>
          ) : (
            <p className="muted review-text">No written review.</p>
          )}
        </div>
      </div>
      {(isOwn || showProfileLink) && <div className="post-footer">
        {isOwn ? (
          <div>
            <button onClick={() => onEdit(post)}>Edit post</button>
            <button onClick={() => onDelete(post)}>Delete</button>
          </div>
        ) : (
          <button onClick={() => onOpenProfile(post.author.id)}>
            View profile <span>→</span>
          </button>
        )}
      </div>}
    </article>
  );
}
