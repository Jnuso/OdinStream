import { avatarColor, initials } from "../data/social";
import type { useFollowRequests } from "../data/useFollowRequests";
import Skeleton from "./Skeleton";
import "./FollowRequests.css";

export function RequestBadge({ count, hasMore = false }: { count: number; hasMore?: boolean }) {
  return count > 0 ? <span className="request-badge" role="img" aria-label={`${count}${hasMore ? " or more" : ""} pending follow request${count === 1 ? "" : "s"}`}>{count > 99 ? "99+" : `${count}${hasMore ? "+" : ""}`}</span> : null;
}

export default function FollowRequests({ model, onOpenProfile }: { model: ReturnType<typeof useFollowRequests>; onOpenProfile: (id: string) => void }) {
  return <section className="follow-requests" aria-labelledby="follow-requests-heading">
    <div className="follow-requests-heading"><h2 id="follow-requests-heading">Follow requests</h2><RequestBadge count={model.items.length} hasMore={model.hasMore} /></div>
    {model.error && <div className="request-error"><p className="form-error" role="alert">{model.error}</p><button className="text-button" onClick={() => void model.refresh()}>Retry</button></div>}
    {model.loading ? <Skeleton variant="rows" label="Loading follow requests…" count={2} /> : <>
      {!model.items.length && !model.error && <p className="muted small">No pending follow requests.</p>}
      <div className="follow-request-list">{model.items.map(request => <div className="follow-request-row" key={request.user_id}>
        <button className="author-link" onClick={() => onOpenProfile(request.user_id)}><span className={`avatar ${avatarColor(request.user_id)}`}>{initials(request.display_name)}</span><span><strong>{request.display_name}</strong><small>@{request.handle}</small></span></button>
        <div className="request-actions" aria-busy={model.busy === request.user_id}>
          <button className="primary" aria-label={`Approve ${request.display_name}`} aria-disabled={!!model.busy || model.loadingMore} onClick={() => void model.resolve(request.user_id, "approve")}>Approve</button>
          <button className="secondary" aria-label={`Decline ${request.display_name}`} aria-disabled={!!model.busy || model.loadingMore} onClick={() => void model.resolve(request.user_id, "decline")}>Decline</button>
        </div>
      </div>)}</div>
      {model.hasMore && <button className="secondary" disabled={model.loadingMore || !!model.busy} onClick={() => void model.loadMore()}>{model.loadingMore ? "Loading more…" : "More requests"}</button>}
    </>}
  </section>;
}
