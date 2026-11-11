import type { Title } from "../data/mock";

export default function Poster({ title }: { title: Title }) {
  return (
    <div className={`poster poster-${title.id}`} aria-hidden="true">
      <span className="poster-orbit" />
      <small>AN ODINSTREAM PICK</small>
      <strong>{title.name}</strong>
      <span>
        {title.year} · {title.genre.toUpperCase()}
      </span>
    </div>
  );
}
