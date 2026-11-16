import {
  catalog,
  countryOptions,
  currentUserId,
  initialState,
  serviceOptions,
  users,
  type SocialState,
} from "./mock";

export const storageKey = "odinstream-social-demo-v1";
export function readState(): SocialState {
  try {
    const state = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    if (
      !state ||
      !Array.isArray(state.posts) ||
      !Array.isArray(state.following) ||
      !Array.isArray(state.services)
    )
      return initialState;
    if (
      !countryOptions.includes(state.country) ||
      !state.services.every(
        (service: unknown) =>
          typeof service === "string" && serviceOptions.includes(service),
      )
    )
      return initialState;
    if (
      !state.following.every((id: unknown) =>
        users.some((user) => user.id === id && id !== currentUserId),
      )
    )
      return initialState;
    if (
      !state.posts.every(
        (post: SocialState["posts"][number]) =>
          post &&
          typeof post.id === "string" &&
          users.some((user) => user.id === post.userId) &&
          catalog.some((title) => title.id === post.titleId) &&
          Number.isInteger(post.rating) &&
          post.rating >= 1 &&
          post.rating <= 5 &&
          typeof post.review === "string" &&
          post.review.length <= 1000 &&
          typeof post.createdAt === "string" &&
          Number.isFinite(Date.parse(post.createdAt)),
      )
    )
      return initialState;
    if (
      new Set(state.posts.map((post: SocialState["posts"][number]) => post.id))
        .size !== state.posts.length
    )
      return initialState;
    return {
      ...state,
      following: [...new Set(state.following)],
      services: [...new Set(state.services)],
    };
  } catch {
    return initialState;
  }
}
