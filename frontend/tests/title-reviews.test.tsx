// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import TitleDetails from "../src/components/TitleDetails";

const title = { id: 603, media_type: "movie", name: "The Matrix", poster_path: null, release_date: "1999-03-31", overview: "A classic.", genres: [], seasons: [], runtime: 136, availability: { flatrate: [], rent: [], buy: [], link: null } };
const post = { id: "post", tmdb_id: 603, media_type: "movie", title_name: "The Matrix", poster_path: null, release_date: "1999-03-31", rating: 4.5, review: "Still holds up.", created_at: "2026-11-19T12:00:00Z", updated_at: "2026-11-19T12:00:00Z", author: { id: "me", display_name: "Raif", handle: "Raif" } };
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function fixture(own: boolean, status: string | null = null, laterPage = false) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const path = url.pathname;
    if (path === "/api/me/saved-titles") {
      if (init?.method === "POST") return new Response(JSON.stringify({ status: "watchlist" }), { status: 201 });
      if (laterPage && url.searchParams.get("offset") === "0") return new Response(JSON.stringify({ items: [], next_offset: 50 }));
      return new Response(JSON.stringify({ items: status ? [{ media_type: "movie", tmdb_id: 603, status }] : [], next_offset: null }));
    }
    return new Response(JSON.stringify(path.endsWith("/recommendations") ? { items: [title], basis: "genres" } : path.endsWith("/posts") ? { items: own ? [post] : [] } : title));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
it("opens a title review with the selected title", async () => {
  fixture(false); const review = vi.fn();
  render(<TitleDetails token="token" selection={{ media_type: "movie", id: 603 }} onClose={vi.fn()} onOpenTitle={vi.fn()} onOpenProfile={vi.fn()} onReview={review} />);
  await screen.findByText("No reviews yet. Share what you thought.");
  fireEvent.click(screen.getByRole("button", { name: "Write a review" }));
  expect(review).toHaveBeenCalledWith(title);
});

it("recognizes a watchlisted title even on a later library page", async () => {
  const fetchMock = fixture(false, "watchlist", true);
  render(<TitleDetails token="token" selection={{ media_type: "movie", id: 603 }} onClose={vi.fn()} onOpenTitle={vi.fn()} onOpenProfile={vi.fn()} />);
  const button = await screen.findByRole("button", { name: /In your watchlist/ }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(screen.queryByRole("button", { name: "Add to watchlist" })).toBeNull();
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes("offset=50"))).toBe(true);
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
});

it("updates the button immediately after adding a title", async () => {
  const fetchMock = fixture(false);
  render(<TitleDetails token="token" selection={{ media_type: "movie", id: 603 }} onClose={vi.fn()} onOpenTitle={vi.fn()} onOpenProfile={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Add to watchlist" }));
  const button = await screen.findByRole("button", { name: /In your watchlist/ }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1));
});

it("shows the existing watched status without offering a duplicate save", async () => {
  fixture(false, "watched");
  render(<TitleDetails token="token" selection={{ media_type: "movie", id: 603 }} onClose={vi.fn()} onOpenTitle={vi.fn()} onOpenProfile={vi.fn()} />);
  const button = await screen.findByRole("button", { name: "Watched", exact: true }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(screen.queryByRole("button", { name: "Add to watchlist" })).toBeNull();
});
it("offers to edit an existing review instead of creating a duplicate", async () => {
  fixture(true); const edit = vi.fn(); const review = vi.fn();
  render(<TitleDetails token="token" selection={{ media_type: "movie", id: 603 }} onClose={vi.fn()} onOpenTitle={vi.fn()} onOpenProfile={vi.fn()} onReview={review} onEdit={edit} viewerId="me" />);
  expect(await screen.findByText("Still holds up.")).toBeTruthy();
  fireEvent.click(await screen.findByRole("button", { name: "Edit your review" }));
  expect(edit).toHaveBeenCalledWith(post);
  expect(review).not.toHaveBeenCalled();
});
