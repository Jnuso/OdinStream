// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";
import App from "../src/App";
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
