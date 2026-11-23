import { api } from "./api";
import { createPageCache } from "./pageCache";

export type Preferences = { favorite_genres: string[]; streaming_services: string[] };

export const preferenceOptions = {
  favorite_genres: ["Action", "Animation", "Comedy", "Documentary", "Drama", "Fantasy", "Horror", "Romance", "Science Fiction", "Thriller"],
  streaming_services: ["Netflix", "Max", "Apple TV+", "Hulu", "Disney+"],
};

export function createPreferencesCache(token: string) {
  return createPageCache(() => api<Preferences>("/api/me/preferences", token));
}
