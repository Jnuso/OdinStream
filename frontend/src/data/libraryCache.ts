import { api } from "./api";
import { createPageCache } from "./pageCache";

export type SavedEntry = { id: string; media_type: "movie" | "tv"; tmdb_id: number; status: string };
export type LibraryPage = { items: SavedEntry[]; next_offset?: number | null };

export function createLibraryCache(token: string | null) {
  return createPageCache(() => api<LibraryPage>("/api/me/saved-titles", token ?? undefined));
}
