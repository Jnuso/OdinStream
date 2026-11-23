import { api } from "./api";
import { createPageCache } from "./pageCache";

export type Preferences = { favorite_genres: string[]; streaming_services: string[] };

export function createPreferencesCache(token: string) {
  return createPageCache(() => api<Preferences>("/api/me/preferences", token));
}
