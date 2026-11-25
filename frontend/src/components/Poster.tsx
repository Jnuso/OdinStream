import { initials } from "../data/social";

export default function Poster({
  name,
  posterPath,
  size = "w342",
}: {
  name: string;
  posterPath: string | null;
  size?: "w185" | "w342";
}) {
  if (posterPath) {
    return (
      <img
        className={`poster-image poster-${size}`}
        src={`https://image.tmdb.org/t/p/${size}${posterPath}`}
        alt=""
        loading="lazy"
      />
    );
  }
  const label = initials(name);
  return (
    <div className={`poster-fallback poster-${size}`} aria-hidden="true" data-initial={label.slice(0, 1)}>
      <span>{label}</span>
    </div>
  );
}
