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
  return (
    <div className={`poster-fallback poster-${size}`} aria-hidden="true">
      <span>{initials(name)}</span>
    </div>
  );
}
