import { useEffect, useRef, useState } from "react";
import { fetchFeed, type Post } from "../data/social";
import PostList from "./PostList";
import Skeleton from "./Skeleton";
import type { createPageCache } from "../data/pageCache";

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
  cache,
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
  cache?: ReturnType<typeof createPageCache<Awaited<ReturnType<typeof fetchFeed>>>>;
}) {
  const [loaded, setLoaded] = useState<{ token: string; viewerId: string; scope: "public" | "following"; requestKey: string; items: Post[]; next_offset: number | null } | null>(() => {
    const page = cache?.peek();
    return page ? { ...page, token, viewerId, scope, requestKey: "" } : null;
  });
  const generation = useRef(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const requestKey = JSON.stringify([token, viewerId, scope, attempt, reloadKey]);
  const visible = loaded?.token === token && loaded.viewerId === viewerId ? loaded : null;
  const posts = visible?.items ?? null;
  const nextOffset = visible?.next_offset ?? null;
  const pending = visible?.requestKey !== requestKey;
  const displayedScope = visible?.scope ?? scope;

  useEffect(() => {
    let active = true;
    generation.current += 1;
    setLoadingMore(false);
    setError("");
    (cache?.load() ?? fetchFeed(token, scope))
      .then((page) => { if (active) setLoaded({ ...page, token, viewerId, scope, requestKey }); })
      .catch((err) => active && setError(err instanceof Error ? err.message : "The feed could not be loaded."));
    return () => {
      active = false;
      generation.current += 1;
    };
  }, [cache, token, viewerId, scope, requestKey]);

  async function loadMore() {
    if (nextOffset === null || pending || loadingMore) return;
    const started = generation.current;
    setLoadingMore(true);
    try {
      const page = await fetchFeed(token, scope, nextOffset);
      if (started !== generation.current) return;
      setLoaded(previous => previous?.requestKey === requestKey ? { ...previous, items: [...previous.items, ...page.items], next_offset: page.next_offset } : previous);
    } catch (err) { if (started === generation.current) setError(err instanceof Error ? err.message : "Could not load more posts."); }
    finally { if (started === generation.current) setLoadingMore(false); }
  }

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
          aria-pressed={displayedScope === "following"}
          className={displayedScope === "following" ? "active" : ""}
          onClick={() => onScope("following")}
        >
          Following
        </button>
        <button
          aria-pressed={displayedScope === "public"}
          className={displayedScope === "public" ? "active" : ""}
          onClick={() => onScope("public")}
        >
          Public
        </button>
      </div>
      <div aria-busy={pending && !error} aria-label="Feed posts">
      {error ? (
        <section className="empty">
          <h2>The feed is unavailable.</h2>
          <p>{error}</p>
          <button className="primary" onClick={() => setAttempt((value) => value + 1)}>
            Try again
          </button>
        </section>
      ) : posts === null ? (
        <Skeleton label="Loading the feed…" variant="posts" />
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
                {displayedScope === "following" ? "Your following feed is empty." : "No ratings yet."}
              </h2>
              <p>
                {displayedScope === "following"
                  ? "Follow other viewers to see their reviews here, or read the public feed."
                  : "Be the first to rate a movie or show."}
              </p>
              <button
                className="primary"
                onClick={() => (displayedScope === "following" ? onScope("public") : onNewPost())}
              >
                {displayedScope === "following" ? "Explore the public feed →" : "Write the first post →"}
              </button>
            </section>
          }
        />
      )}
      {posts && nextOffset !== null && <button className="secondary" disabled={loadingMore || pending} onClick={() => void loadMore()}>Load more posts</button>}
      </div>
    </>
  );
}
