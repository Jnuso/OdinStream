import { api } from "./api";
import { createPageCache } from "./pageCache";

export type Preferences = { favorite_genres: string[]; streaming_services: string[] };

export const preferenceOptions = {
  favorite_genres: [
    "Action", "Action & Adventure", "Adventure", "Animation", "Comedy", "Crime", "Documentary",
    "Drama", "Family", "Fantasy", "History", "Horror", "Kids", "Music", "Mystery", "News", "Reality",
    "Romance", "Sci-Fi & Fantasy", "Science Fiction", "Soap", "Talk", "Thriller", "TV Movie", "War",
    "War & Politics", "Western",
  ],
  streaming_services: ["Netflix", "Max", "Apple TV+", "Hulu", "Disney+"],
};

export function createPreferencesCache(token: string) {
  return createPageCache(() => api<Preferences>("/api/me/preferences", token));
}
