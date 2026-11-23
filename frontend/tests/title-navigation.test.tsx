// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";
import App from "../src/App";
import TitleDetails from "../src/components/TitleDetails";
import ActorCredits from "../src/components/ActorCredits";
import { clearCatalogCache } from "../src/data/catalogCache";

const auth = vi.hoisted(() => ({ changed: null as ((event: string, session: Session | null) => void) | null }));
vi.mock("../src/data/auth", () => ({ authCallbackError: null, supabase: { auth: {
  onAuthStateChange(callback: typeof auth.changed) { auth.changed = callback; return { data: { subscription: { unsubscribe() {} } } }; },
} } }));

const id = "11111111-1111-4111-8111-111111111111";
const profile = { id, display_name: "Maya", handle: "maya", bio: "", visibility: "public", viewer_follows: false, post_count: 1, follower_count: 0, following_count: 0 };
const title = { id: 42, media_type: "tv", name: "Severance", poster_path: null, overview: "A show.", release_date: "2022-01-01", genres: [], seasons: [], runtime: null, availability: { flatrate: [], rent: [], buy: [], link: null } };
const post = { id: "post", media_type: "tv", tmdb_id: 42, title_name: "Severance", poster_path: null, release_date: "2022-01-01", rating: 4.5, review: "Great.", created_at: "2026-11-19T12:00:00Z", updated_at: "2026-11-19T12:00:00Z", author: profile };

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => { cleanup(); clearCatalogCache(); vi.unstubAllGlobals(); auth.changed = null; window.history.replaceState(null, "", "/"); });

it("opens an actor's other credits and navigates to a credited title", async () => {
  const actor = { id: 7, name: "Adam Scott", profile_path: null, characters: ["Mark Scout"] };
  const movie = { ...title, media_type: "movie", name: "A movie", characters: ["Alex"] };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => (
    String(input).endsWith("/people/7/credits")
      ? Response.json({ items: [{ ...title, characters: actor.characters }, movie] })
      : Response.json({ ...title, cast: [actor] })
  )));
  const openTitle = vi.fn();
  render(<TitleDetails selection={{ media_type: "tv", id: title.id }} token={null}
    onClose={vi.fn()} onOpenTitle={openTitle} />);
  fireEvent.click(await screen.findByRole("button", { name: /Adam Scott/ }));
  await screen.findByRole("dialog", { name: "Adam Scott acting credits" });
  expect(screen.queryByRole("button", { name: /^Severance/ })).toBeNull();
  fireEvent.click(await screen.findByRole("button", { name: /A movie.*2022.*Alex/ }));
  expect(openTitle).toHaveBeenCalledWith("movie", title.id);
  expect(screen.queryByRole("dialog", { name: "Adam Scott acting credits" })).toBeNull();
});

it("loads an actor profile and persists the favorite toggle across panel visits", async () => {
  const actor = { id: 7, name: "Adam Scott" };
  let favorited = false;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const path = new URL(String(input), "http://localhost").pathname;
    if (path === "/api/me/favorite-people/7") {
      if (options?.method === "PUT") favorited = true;
      if (options?.method === "DELETE") {
        favorited = false;
        return new Response(null, { status: 204 });
      }
      return Response.json({ favorited });
    }
    if (path.endsWith("/credits")) return Response.json({ items: [] });
    return Response.json({ ...actor, biography: "An actor and producer.", place_of_birth: "Santa Cruz" });
  }));
  const panel = <ActorCredits actor={actor} token="token" onClose={vi.fn()} onOpenTitle={vi.fn()} />;
  const first = render(panel);
  await screen.findByText("An actor and producer.");
  await waitFor(() => expect((screen.getByRole("button", { name: "Favorite" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Favorite" }));
  await screen.findByRole("button", { name: "Favorited", pressed: true });
  first.unmount();
  render(panel);
  fireEvent.click(await screen.findByRole("button", { name: "Favorited", pressed: true }));
  await screen.findByRole("button", { name: "Favorite", pressed: false });
  expect(favorited).toBe(false);
});

it("waits for Discover and lets Feed join its in-flight preload", async () => {
  let resolveTrending!: (response: Response) => void;
  let resolveLibrary!: (response: Response) => void;
  let resolveFeed!: (response: Response) => void;
  const trending = new Promise<Response>(resolve => { resolveTrending = resolve; });
  const library = new Promise<Response>(resolve => { resolveLibrary = resolve; });
  const feed = new Promise<Response>(resolve => { resolveFeed = resolve; });
  const order: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), "http://localhost").pathname;
    if (path === "/api/catalog/trending") return trending;
    if (path === "/api/me/saved-titles") { order.push("library"); return library; }
    if (path === "/api/feed") { order.push("feed"); return feed; }
    if (path === `/api/profiles/${id}/posts`) order.push("profile");
    if (path.endsWith("/setup")) return Response.json({ setup_complete: true });
    if (path === "/api/me/profile") return Response.json(profile);
    return Response.json({ items: [], streaming_services: [], next_offset: null });
  }));
  render(<App />);
  await act(async () => auth.changed!("INITIAL_SESSION", { access_token: "token", user: { id } } as Session));
  await screen.findByRole("heading", { name: "Discover" });
  expect(order).toEqual([]);
  await act(async () => resolveTrending(Response.json({ items: [{ ...title, backdrop_path: "/hero.jpg" }] })));
  expect(order).toEqual([]);
  fireEvent.load(document.querySelector(".discover-feature-art")!);
  await waitFor(() => expect(order).toEqual(["library"]));
  await act(async () => resolveLibrary(Response.json({ items: [] })));
  await waitFor(() => expect(order).toEqual(["library", "feed"]));
  fireEvent.click(screen.getAllByRole("button", { name: "Feed", exact: true })[0]);
  await screen.findByRole("heading", { name: "Feed" });
  await act(async () => resolveFeed(Response.json({ items: [post], next_offset: null })));
  await screen.findByRole("button", { name: "Open Severance details" });
  expect(order).toEqual(["library", "feed"]);
});

it.each(["library", "feed", "profile/me"])("opens title details over %s without changing tabs", async route => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), "http://localhost").pathname;
    const body = path.endsWith("/setup") ? { setup_complete: true }
      : path.endsWith("/follow-requests") || path === "/api/profiles" ? { items: [], next_offset: null }
      : path === "/api/me/saved-titles" ? { items: [{ id: "saved", media_type: "tv", tmdb_id: 42, status: "watchlist" }], next_offset: null }
      : path.endsWith("/episodes") ? { items: [], last_watched: null }
      : path.startsWith("/api/catalog/") ? title
      : path === "/api/feed" || path.endsWith("/posts") ? { items: [post], next_offset: null }
      : profile;
    return new Response(JSON.stringify(body));
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState(null, "", `/#/${route}`);
  render(<App />);
  await act(async () => auth.changed!("INITIAL_SESSION", { access_token: "token", user: { id } } as Session));
  if (route === "library") {
    fireEvent.click(await screen.findByRole("button", { name: "Watchlist", exact: true }));
    fireEvent.click(await screen.findByRole("button", { name: /^Severance TV show/ }));
  } else fireEvent.click(await screen.findByRole("button", { name: "Open Severance details" }));
  await screen.findByRole("dialog", { name: "Severance details" });
  expect(window.location.hash).toBe(`#/${route}`);
  fireEvent.click(screen.getByRole("button", { name: "Close Severance details" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(window.location.hash).toBe(`#/${route}`);
  if (route === "library") {
    expect(screen.getByRole("button", { name: "Watchlist", exact: true, pressed: true })).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([url]) => new URL(String(url), "http://localhost").pathname === "/api/me/saved-titles" && !String(url).includes("?"))).toHaveLength(1);
  }
});
