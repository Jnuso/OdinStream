import "./Skeleton.css";

type Variant = "posts" | "posters" | "rows" | "profile" | "form" | "episodes";

function Lines() {
  return <div className="skeleton-lines"><span className="skeleton-bone skeleton-line" /><span className="skeleton-bone skeleton-line short" /></div>;
}

export default function Skeleton({ variant = "posts", label, count }: { variant?: Variant; label: string; count?: number }) {
  const amount = count ?? (variant === "posters" ? 6 : variant === "profile" || variant === "form" ? 1 : 3);
  return <div className={`skeleton skeleton-${variant}`} role="status" aria-label={label}>
    <span className="sr-only">{label}</span>
    <div className="skeleton-content" aria-hidden="true">
      {Array.from({ length: amount }, (_, index) => <div className="skeleton-item" key={index}>
        {variant === "posts" && <><div className="skeleton-author"><span className="skeleton-bone skeleton-avatar" /><Lines /></div><div className="skeleton-row"><span className="skeleton-bone skeleton-poster" /><Lines /></div></>}
        {variant === "posters" && <><span className="skeleton-bone skeleton-poster" /><Lines /></>}
        {(variant === "rows" || variant === "episodes") && <div className="skeleton-row"><span className="skeleton-bone skeleton-poster" /><Lines /></div>}
        {variant === "profile" && <><div className="skeleton-row"><span className="skeleton-bone skeleton-avatar" /><Lines /></div><div className="skeleton-profile-stats"><span className="skeleton-bone" /><span className="skeleton-bone" /><span className="skeleton-bone" /></div></>}
        {variant === "form" && <><Lines /><div className="skeleton-chips">{Array.from({ length: 8 }, (_, chip) => <span className="skeleton-bone" key={chip} />)}</div><Lines /><span className="skeleton-bone skeleton-submit" /></>}
      </div>)}
    </div>
  </div>;
}
