export type Favorite = {
  id: number;
  name: string;
  media_type?: "movie" | "tv";
  release_date?: string | null;
  poster_path?: string | null;
  profile_path?: string | null;
  known_for_department?: string | null;
  known_for?: string[];
};

export function favoriteKey(item: Favorite) {
  return `${item.media_type ?? "person"}:${item.id}`;
}
