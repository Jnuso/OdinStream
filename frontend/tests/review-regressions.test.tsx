// @vitest-environment jsdom
// Regression coverage for asynchronous navigation and cache lifetimes.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearCatalogCache } from "../src/data/catalogCache";
import Discover from "../src/components/Discover";
import Library from "../src/components/Library";
import FollowRequests from "../src/components/FollowRequests";
import { useFollowRequests } from "../src/data/useFollowRequests";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => { clearCatalogCache(); cleanup(); vi.unstubAllGlobals(); });
const title = (id: number) => ({ id, media_type: "movie", name: `Title ${id}`, poster_path: null, release_date: null, overview: "", runtime: null, genres: [], seasons: [], availability: { flatrate: [], rent: [], buy: [], link: null } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

it("ignores completed saves belonging to a previously opened title", async () => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { finish = resolve; });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), "http://localhost").pathname;
    if (init?.method === "POST") return pending;
    if (path.endsWith("/recommendations")) return json({ items: [title(1), title(2)], basis: "genres" });
    if (path.endsWith("/saved-titles") || path.endsWith("/posts")) return json({ items: [], next_offset: null });
    return json(title(Number(path.split("/").at(-1))));
  }));
  render(<Discover token="token" focus={null} onFocusHandled={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: /^Title 1/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Add to watchlist" }));
  fireEvent.click(screen.getByRole("button", { name: "Close Title 1 details" }));
  fireEvent.click(screen.getByRole("button", { name: /^Title 2/ }));
  await screen.findByRole("dialog", { name: "Title 2 details" });
  // Allow Title 2's library query to finish before Title 1's POST.
  await act(async () => { await Promise.resolve(); });
  await act(async () => finish(json({ status: "watchlist" }, 201)));
  const button = screen.getByRole("button", { name: "Add to watchlist" }) as HTMLButtonElement;
  expect(button.disabled).toBe(false);
  expect(screen.queryByText("Added to your watchlist.")).toBeNull();
});

it("keeps search cleared after an earlier request finishes", async () => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { finish = resolve; });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname.endsWith("/recommendations")) return json({ items: [], basis: "genres" });
    if (url.searchParams.get("query") === "second") return pending;
    return json({ items: [title(1)], page: 1, total_pages: 1 });
  }));
  render(<Discover token="token" focus={null} onFocusHandled={() => {}} />);
  fireEvent.change(screen.getByLabelText("Search titles"), { target: { value: "first" } });
  fireEvent.click(screen.getByRole("button", { name: "Search", exact: true }));
  await screen.findByRole("heading", { name: "Results for “first”" });
  fireEvent.change(screen.getByLabelText("Search titles"), { target: { value: "second" } });
  fireEvent.click(screen.getByRole("button", { name: "Search", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(screen.queryByRole("heading", { name: /Results for/ })).toBeNull();
  await act(async () => finish(json({ items: [title(2)], page: 1, total_pages: 1 })));
  expect(screen.queryByRole("heading", { name: "Results for “second”" })).toBeNull();
  expect((screen.getByLabelText("Search titles") as HTMLInputElement).value).toBe("");
});

function RequestHarness() {
  const model = useFollowRequests("token", "me", true, 0, () => {});
  return <FollowRequests model={model} onOpenProfile={() => {}} />;
}
it("preserves later request pages when refreshing on focus", async () => {
  const person = (id: string) => ({ user_id: id, display_name: id, handle: id, created_at: "2026-11-19" });
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const later = new URL(String(input), "http://localhost").searchParams.has("offset");
    return json({ items: [person(later ? "Leo" : "Maya")], next_offset: later ? null : 1 });
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<RequestHarness />);
  fireEvent.click(await screen.findByRole("button", { name: "More requests" }));
  await screen.findByRole("button", { name: "Approve Leo" });
  fireEvent.focus(window);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
  expect(screen.getByRole("button", { name: "Approve Leo" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "More requests" })).toBeNull();
});

it("reuses catalog data on library revisits without exhausting the rate budget", async () => {
  let catalogCalls = 0;
  let progressReads = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), "http://localhost").pathname;
    if (path.includes("/api/catalog/")) {
      if (++catalogCalls > 60) return json({ message: "Too many requests. Please slow down and try again." }, 429);
      return json(path.includes("/seasons/") ? { episodes: [{ episode_number: 1, name: "Pilot" }, { episode_number: 2, name: "Next" }] }
        : { name: path, poster_path: null, seasons: [{ season_number: 1, name: "Season 1", episode_count: 2 }] });
    }
    if (path.endsWith("/episodes")) { progressReads++; return json({ items: [{ season_number: 1, episode_number: 1 }], last_watched: { season_number: 1, episode_number: 1 } }); }
    return json({ items: Array.from({ length: 20 }, (_, id) => ({ id: String(id), media_type: "tv", tmdb_id: id + 1, status: "watching" })), next_offset: null });
  }));
  const first = render(<Library token="token" />);
  await waitFor(() => expect(screen.getAllByText("Next: S1 E2 · Next")).toHaveLength(20));
  expect(catalogCalls).toBe(40);
  first.unmount();
  render(<Library token="token" />);
  await waitFor(() => expect(screen.getAllByText("Next: S1 E2 · Next")).toHaveLength(20));
  expect(catalogCalls).toBe(40);
  expect(progressReads).toBe(40);
});
