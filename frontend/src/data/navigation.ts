import { useSyncExternalStore } from "react";

export type Page = "discover" | "library" | "account" | "feed" | "profile";
type Navigation = { page: Page; feed: "following" | "public"; profileId: string };

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

const sections: Record<string, Page> = {
  discover: "discover",
  library: "library",
  account: "account",
  profile: "profile",
  feed: "feed",
};

export function useNavigation() {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  const [path, query] = hash.slice(1).split("?");
  const [, section, profileId] = (path ?? "").split("/");
  const route: Navigation = {
    page: sections[section] ?? "feed",
    feed: new URLSearchParams(query ?? "").get("feed") === "public" ? "public" : "following",
    profileId: profileId === "me" || /^[0-9a-f-]{36}$/i.test(profileId ?? "") ? profileId : "me",
  };
  function navigate(next: Navigation) {
    const target =
      next.page === "profile" ? `/profile/${next.profileId || "me"}` : `/${next.page}`;
    window.location.hash = `${target}?feed=${next.feed}`;
  }
  return { ...route, navigate };
}
