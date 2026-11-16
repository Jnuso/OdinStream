import { useSyncExternalStore } from "react";
import { currentUserId, users } from "./mock";

type Navigation = {
  page: "feed" | "profile";
  feed: "following" | "public";
  profileId: string;
};
function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}
export function useNavigation() {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  const [path, query] = hash.slice(1).split("?");
  const [, section, userId] = (path ?? "").split("/");
  const route: Navigation = {
    page: section === "profile" ? "profile" : "feed",
    feed:
      new URLSearchParams(query).get("feed") === "public"
        ? "public"
        : "following",
    profileId: users.some((user) => user.id === userId)
      ? userId
      : currentUserId,
  };
  function navigate(next: Navigation) {
    const path =
      next.page === "profile" ? `/profile/${next.profileId}` : "/feed";
    window.location.hash = `${path}?feed=${next.feed}`;
  }
  return { ...route, navigate };
}
