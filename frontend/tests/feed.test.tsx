// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import Feed from "../src/components/Feed";
import { clearCatalogCache } from "../src/data/catalogCache";
import { fetchFeed, type Post } from "../src/data/social";

vi.mock("../src/data/social", async (original) => ({ ...await original<typeof import("../src/data/social")>(), fetchFeed: vi.fn() }));
const fetchMock = vi.mocked(fetchFeed);
afterEach(() => { cleanup(); clearCatalogCache(); vi.resetAllMocks(); vi.unstubAllGlobals(); });
const props = { token: "token", viewerId: "me", scope: "following" as const, onScope: vi.fn(), onOpenProfile: vi.fn(), onOpenTitle: vi.fn(), onEdit: vi.fn(), onNewPost: vi.fn(), reloadKey: 0 };
function page(title: string) {
  const post: Post = { id: title, title_name: title, media_type: "movie", tmdb_id: 1, poster_path: null, release_date: null, rating: 4.5, review: "Worth a watch.", created_at: "2026-11-19T12:00:00Z", updated_at: "2026-11-19T12:00:00Z", author: { id: "me", display_name: "Me", handle: "me" } };
  return { items: [post], next_offset: null };
}
function deferred() {
  let resolve!: (data: ReturnType<typeof page>) => void;
  return { promise: new Promise<ReturnType<typeof page>>(done => { resolve = done; }), resolve: (data: ReturnType<typeof page>) => resolve(data) };
}

it("fills in missing posters from the catalog without duplicate title requests", async () => {
  const first = page("First review").items[0];
  const second = { ...first, id: "second", author: { id: "other", display_name: "Other", handle: "other" } };
  fetchMock.mockResolvedValueOnce({ items: [first, second], next_offset: null });
  const catalog = vi.fn().mockResolvedValue(new Response(JSON.stringify({ poster_path: "/poster.jpg" })));
  vi.stubGlobal("fetch", catalog);
  render(<Feed {...props} />);
  const posters = await screen.findAllByRole("button", { name: "Open First review details" });
  await waitFor(() => {
    expect(posters.map(button => button.querySelector("img")?.getAttribute("src"))).toEqual([
      "https://image.tmdb.org/t/p/w185/poster.jpg",
      "https://image.tmdb.org/t/p/w185/poster.jpg",
    ]);
  });
  expect(catalog).toHaveBeenCalledTimes(1);
  expect(catalog.mock.calls[0][0]).toMatch(/\/api\/catalog\/movie\/1$/);
});

it("keeps the current feed visible until the next tab is ready", async () => {
  const pending = deferred();
  fetchMock.mockResolvedValueOnce(page("Following title")).mockReturnValueOnce(pending.promise);
  const view = render(<Feed {...props} />);
  await screen.findByRole("button", { name: /^Following title/ });
  view.rerender(<Feed {...props} scope="public" />);
  expect(screen.queryByText("Loading the feed…")).toBeNull();
  expect(screen.getByRole("button", { name: /^Following$/, pressed: true })).toBeTruthy();
  expect(screen.getByRole("button", { name: /^Following title/ })).toBeTruthy();
  await act(async () => pending.resolve(page("Public title")));
  expect(screen.getByRole("button", { name: /^Public$/, pressed: true })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^Following title/ })).toBeNull();
  expect(screen.getByRole("button", { name: /^Public title/ })).toBeTruthy();
});

it("ignores late responses when switching tabs quickly", async () => {
  const publicRequest = deferred();
  fetchMock.mockResolvedValueOnce(page("First following"))
    .mockReturnValueOnce(publicRequest.promise).mockResolvedValueOnce(page("Fresh following"));
  const view = render(<Feed {...props} />);
  await screen.findByRole("button", { name: /^First following/ });
  view.rerender(<Feed {...props} scope="public" />);
  view.rerender(<Feed {...props} scope="following" />);
  await screen.findByRole("button", { name: /^Fresh following/ });
  await act(async () => publicRequest.resolve(page("Stale public")));
  expect(screen.queryByRole("button", { name: /^Stale public/ })).toBeNull();
  expect(screen.getByRole("button", { name: /^Fresh following/ })).toBeTruthy();
});

it("does not retain another account's feed when the session changes", async () => {
  const pending = deferred();
  fetchMock.mockResolvedValueOnce(page("Private title")).mockReturnValueOnce(pending.promise);
  const view = render(<Feed {...props} />);
  await screen.findByRole("button", { name: /^Private title/ });
  view.rerender(<Feed {...props} token="another-token" viewerId="another-user" />);
  expect(screen.queryByRole("button", { name: /^Private title/ })).toBeNull();
  expect(screen.getByText("Loading the feed…")).toBeTruthy();
  await act(async () => pending.resolve(page("New account title")));
});
