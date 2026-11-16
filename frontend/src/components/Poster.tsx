import type { Title } from "../data/mock";

export default function Poster({ title }: { title: Title }) {
  return (
    <div className={`poster poster-${title.id}`} aria-hidden="true">
      <span className="poster-orbit" />
      <strong>{title.name}</strong>
    </div>
  );
}
