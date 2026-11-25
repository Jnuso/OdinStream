// @vitest-environment jsdom
import { clearCatalogCache } from "../src/data/catalogCache";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import Library from "../src/components/Library";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => { clearCatalogCache(); cleanup(); vi.unstubAllGlobals(); });

function fixture() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), "http://localhost").pathname;
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    if (path.endsWith("/episodes")) return new Response(JSON.stringify({ items: [], last_watched: null }));
    const body = path === "/api/me/saved-titles" ? { items: [
      { id: "first", media_type: "movie", tmdb_id: 1, status: "watchlist" },
      { id: "second", media_type: "tv", tmdb_id: 2, status: "completed" },
    ] } : { name: path.endsWith("/1") ? "Dune" : "Severance", poster_path: null, seasons: [] };
    return new Response(JSON.stringify(body));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

it("filters loaded titles and groups completed shows with watched movies", async () => {
  fixture(); render(<Library token="token" />);
  await screen.findByText("Dune");
  fireEvent.click(screen.getByRole("button", { name: "Watched", exact: true }));
  expect(screen.queryByText("Dune")).toBeNull();
  expect(screen.getByText("Severance")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "All titles" }));
  expect(screen.getByText("Dune")).toBeTruthy();
});

it("loads completed show progress only after expanding its checklist", async () => {
  const fetchMock = fixture();
  render(<Library token="token" />);
  await screen.findByText("Severance");
  const progressRequests = () => fetchMock.mock.calls.filter(([input]) =>
    String(input).endsWith("/api/me/saved-titles/second/episodes"),
  );
  expect(progressRequests()).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Episode progress" }));
  await screen.findByText(/0 episodes marked watched/);
  expect(progressRequests()).toHaveLength(1);
});

it("requires confirmation before removing a saved title", async () => {
  const fetchMock = fixture(); render(<Library token="token" />);
  await screen.findByText("Dune");
  fireEvent.click(screen.getAllByRole("button", { name: "Remove", exact: true })[0]);
  expect(screen.getByRole("dialog", { name: "Remove saved title" })).toBeTruthy();
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByText("Dune")).toBeTruthy();
  fireEvent.click(screen.getAllByRole("button", { name: "Remove", exact: true })[0]);
  fireEvent.click(screen.getByRole("button", { name: "Remove title" }));
  await waitFor(() => expect(screen.queryByText("Dune")).toBeNull());
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
});

it("opens the selected title using its media type and TMDB id", async () => {
  fixture(); const open = vi.fn(); render(<Library token="token" onOpenTitle={open} />);
  fireEvent.click(await screen.findByRole("button", { name: /Dune/ }));
  expect(open).toHaveBeenCalledWith("movie", 1);
});

it("updates status immediately without disabling other rows, and restores it on failure", async () => {
  const original = fixture();
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { finish = resolve; });
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => init?.method === "PATCH" ? pending : original(input, init)));
  render(<Library token="token" />);
  const status = await screen.findByRole("combobox", { name: "Status for Dune" }) as HTMLSelectElement;
  fireEvent.change(status, { target: { value: "watched" } });
  expect(status.value).toBe("watched");
  expect(status.disabled).toBe(false);
  expect((screen.getByRole("combobox", { name: "Status for Severance" }) as HTMLSelectElement).disabled).toBe(false);
  finish(new Response(JSON.stringify({ message: "Could not save status." }), { status: 503 }));
  expect((await screen.findByRole("alert")).textContent).toContain("Could not save status");
  expect(status.value).toBe("watchlist");
});
