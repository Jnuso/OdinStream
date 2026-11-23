import { api } from "./api";

export type SavedEntry = { id: string; media_type: "movie" | "tv"; tmdb_id: number; status: string };
export type LibraryPage = { items: SavedEntry[]; next_offset?: number | null };

const FRESH_MS = 30_000;

export function createLibraryCache(token: string | null) {
  let snapshot: { page: LibraryPage; fetchedAt: number } | undefined;
  let pending: Promise<LibraryPage> | undefined;

  return {
    peek: () => snapshot?.page,
    load(): Promise<LibraryPage> {
      if (snapshot && Date.now() - snapshot.fetchedAt < FRESH_MS) return Promise.resolve(snapshot.page);
      if (pending) return pending;
      const request = api<LibraryPage>("/api/me/saved-titles", token ?? undefined)
        .then(page => {
          if (pending === request) snapshot = { page, fetchedAt: Date.now() };
          return page;
        })
        .finally(() => {
          if (pending === request) pending = undefined;
        });
      pending = request;
      return request;
    },
    invalidate() {
      snapshot = undefined;
      pending = undefined;
    },
  };
}
