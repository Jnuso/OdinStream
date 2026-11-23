import { api } from "./api";
import { createPageCache } from "./pageCache";

export type SavedEntry = { id: string; media_type: "movie" | "tv"; tmdb_id: number; status: string };
export type LibraryPage = { items: SavedEntry[]; next_offset?: number | null };

export const libraryGroups = [
  ["in-progress", "In Progress"],
  ["watchlist", "Watchlist"],
  ["history", "History"],
] as const;
export type LibraryGroup = typeof libraryGroups[number][0];

export function fetchLibraryPage(token: string | null, group: LibraryGroup, offset = 0) {
  return api<LibraryPage>(`/api/me/saved-titles?group=${group}&offset=${offset}`, token ?? undefined);
}

export function createLibraryCache(token: string | null) {
  const pages = {
    "in-progress": createPageCache(() => fetchLibraryPage(token, "in-progress")),
    watchlist: createPageCache(() => fetchLibraryPage(token, "watchlist")),
    history: createPageCache(() => fetchLibraryPage(token, "history")),
  };
  return {
    pages,
    invalidate() {
      for (const page of Object.values(pages)) page.invalidate();
    },
  };
}
