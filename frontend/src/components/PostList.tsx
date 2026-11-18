import { useState } from "react";
import { removePost, type Post } from "../data/social";
import Modal from "./Modal";
import PostCard from "./PostCard";

export default function PostList({
  token,
  posts,
  viewerId,
  empty,
  onOpenProfile,
  onOpenTitle,
  onEdit,
  onChanged,
}: {
  token: string;
  posts: Post[];
  viewerId: string | null;
  empty: React.ReactNode;
  onOpenProfile: (id: string) => void;
  onOpenTitle: (mediaType: Post["media_type"], tmdbId: number) => void;
  onEdit: (post: Post) => void;
  onChanged: () => void;
}) {
  const [deleting, setDeleting] = useState<Post | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    setError("");
    try {
      await removePost(token, deleting.id);
      setDeleting(null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The post could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  if (!posts.length) return <>{empty}</>;

  return (
    <>
      <div className="post-list">
        {posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            isOwn={post.author.id === viewerId}
            onOpenProfile={onOpenProfile}
            onOpenTitle={onOpenTitle}
            onEdit={onEdit}
            onDelete={setDeleting}
          />
        ))}
      </div>
      {deleting && (
        <Modal label="Delete post" onClose={() => setDeleting(null)}>
          <h2>Delete this post?</h2>
          <p className="muted">
            Your rating and review for {deleting.title_name} will be removed from your profile and the
            feeds.
          </p>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="confirmation-actions">
            <button className="secondary" onClick={() => setDeleting(null)} disabled={busy}>
              Keep post
            </button>
            <button className="primary" onClick={confirmDelete} disabled={busy}>
              {busy ? "Deleting…" : "Delete post"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
