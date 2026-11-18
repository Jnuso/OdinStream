import { useEffect, useState } from "react";
import { fetchFeed, type Post } from "../data/social";
import PostList from "./PostList";

export default function Feed({
  token,
  viewerId,
  scope,
  onScope,
  onOpenProfile,
  onOpenTitle,
  onEdit,
  onNewPost,
  reloadKey,
}: {
  token: string;
  viewerId: string;
  scope: "public" | "following";
  onScope: (scope: "public" | "following") => void;
  onOpenProfile: (id: string) => void;
  onOpenTitle: (mediaType: Post["media_type"], tmdbId: number) => void;
  onEdit: (post: Post) => void;
  onNewPost: () => void;
  reloadKey: number;
}) {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setPosts(null);
    setError("");
    fetchFeed(token, scope)
      .then((items) => active && setPosts(items))
      .catch((err) => active && setError(err instanceof Error ? err.message : "The feed could not be loaded."));
    return () => {
      active = false;
    };
  }, [token, scope, attempt, reloadKey]);

  return (
    <>
      <section className="share-prompt">
        <button onClick={onNewPost}>Rate a movie or show…</button>
        <button className="prompt-plus" aria-label="Create a new post" onClick={onNewPost}>
          +
        </button>
      </section>
      <div className="feed-tabs" aria-label="Feed selection">
        <button
          aria-pressed={scope === "following"}
          className={scope === "following" ? "active" : ""}
          onClick={() => onScope("following")}
        >
          Following
        </button>
        <button
          aria-pressed={scope === "public"}
          className={scope === "public" ? "active" : ""}
          onClick={() => onScope("public")}
        >
          Public
        </button>
      </div>
      {error ? (
        <section className="empty">
          <h2>The feed is unavailable.</h2>
          <p>{error}</p>
          <button className="primary" onClick={() => setAttempt((value) => value + 1)}>
            Try again
          </button>
        </section>
      ) : posts === null ? (
        <p role="status">Loading the feed…</p>
      ) : (
        <PostList
          token={token}
          posts={posts}
          viewerId={viewerId}
          onOpenProfile={onOpenProfile}
          onOpenTitle={onOpenTitle}
          onEdit={onEdit}
          onChanged={() => setAttempt((value) => value + 1)}
          empty={
            <section className="empty">
              <h2>
                {scope === "following" ? "Your following feed is empty." : "No ratings yet."}
              </h2>
              <p>
                {scope === "following"
                  ? "Follow other viewers to see their reviews here, or read the public feed."
                  : "Be the first to rate a movie or show."}
              </p>
              <button
                className="primary"
                onClick={() => (scope === "following" ? onScope("public") : onNewPost())}
              >
                {scope === "following" ? "Explore the public feed →" : "Write the first post →"}
              </button>
            </section>
          }
        />
      )}
    </>
  );
}
