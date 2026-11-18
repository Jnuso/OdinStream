import { api } from "./api";

export type MediaType = "movie" | "tv";

export type Post = {
  id: string;
  media_type: MediaType;
  tmdb_id: number;
  title_name: string;
  poster_path: string | null;
  release_date: string | null;
  rating: number;
  review: string | null;
  created_at: string;
  updated_at: string;
  author: { id: string; display_name: string; handle: string };
};

export type Profile = {
  id: string;
  display_name: string;
  handle: string;
  bio: string;
  post_count: number;
  follower_count: number;
  following_count: number;
  viewer_follows: boolean;
};

export type TitleSummary = {
  id: number;
  media_type: MediaType;
  name: string;
  release_date: string | null;
  overview: string;
  poster_path: string | null;
};

export type Recommendation = TitleSummary & { reason: string | null };

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

const avatarColors = ["olive", "rose", "blue", "sand"];
export function avatarColor(id: string) {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) % 997;
  return avatarColors[hash % avatarColors.length];
}

export async function fetchFeed(token: string, scope: "public" | "following", offset = 0): Promise<Post[]> {
  const data = await api<{ items: Post[] }>(`/api/feed?scope=${scope}&limit=30&offset=${offset}`, token);
  return data.items;
}

export async function fetchProfile(token: string, profileId: string): Promise<Profile> {
  return api<Profile>(`/api/profiles/${profileId}`, token);
}

export async function fetchProfilePosts(token: string, profileId: string): Promise<Post[]> {
  return (await api<{ items: Post[] }>(`/api/profiles/${profileId}/posts`, token)).items;
}

export async function fetchSuggestedProfiles(token: string): Promise<Profile[]> {
  return (await api<{ items: Profile[] }>("/api/profiles?limit=5", token)).items;
}

export async function fetchMyProfile(token: string): Promise<Profile> {
  return api<Profile>("/api/me/profile", token);
}

export async function saveProfile(
  token: string,
  values: { display_name: string; handle: string; bio: string },
): Promise<Profile> {
  return api<Profile>("/api/me/profile", token, { method: "PATCH", body: JSON.stringify(values) });
}

export async function publishPost(
  token: string,
  title: { media_type: MediaType; id: number },
  values: { rating: number; review: string | null },
): Promise<Post> {
  return api<Post>(`/api/titles/${title.media_type}/${title.id}/posts`, token, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export async function editPost(
  token: string,
  postId: string,
  values: { rating: number; review: string | null },
): Promise<Post> {
  return api<Post>(`/api/posts/${postId}`, token, { method: "PATCH", body: JSON.stringify(values) });
}

export async function removePost(token: string, postId: string): Promise<void> {
  await api<void>(`/api/posts/${postId}`, token, { method: "DELETE" });
}

export async function setFollow(token: string, profileId: string, follow: boolean): Promise<void> {
  await api<void>(`/api/profiles/${profileId}/follow`, token, { method: follow ? "PUT" : "DELETE" });
}

export async function fetchRecommendations(token: string): Promise<{ items: Recommendation[]; basis: string }> {
  return api<{ items: Recommendation[]; basis: string }>("/api/me/recommendations", token);
}


export function formatYear(releaseDate: string | null) {
  return releaseDate ? releaseDate.slice(0, 4) : "";
}
