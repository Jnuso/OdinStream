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
  const entries = [
    { id: "first", media_type: "movie", tmdb_id: 1, status: "watchlist" },
    { id: "second", media_type: "tv", tmdb_id: 2, status: "completed" },
    { id: "third", media_type: "movie", tmdb_id: 3, status: "watched" },
    { id: "fourth", media_type: "tv", tmdb_id: 4, status: "dropped" },
    { id: "fifth", media_type: "tv", tmdb_id: 5, status: "watching" },
    { id: "sixth", media_type: "tv", tmdb_id: 6, status: "paused" },
  ];
  const titles = ["Dune", "Severance", "Alien", "Lost", "Andor", "Fargo"];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const path = url.pathname;
    if (init?.method === "DELETE") {
      entries.splice(entries.findIndex(item => path.endsWith(item.id)), 1);
      return new Response(null, { status: 204 });
    }
    if (init?.method === "PATCH") {
      const entry = entries.find(item => path.endsWith(item.id))!;
      entry.status = JSON.parse(String(init.body)).status;
      return Response.json(entry);
    }
    if (path.endsWith("/episodes")) return Response.json({ items: [], last_watched: null });
    if (path === "/api/me/saved-titles") {
      const group = url.searchParams.get("group");
      const statuses = group === "in-progress" ? ["watching", "paused"] : group === "watchlist"
        ? ["watchlist"] : ["completed", "watched", "dropped"];
      const items = entries.filter(item => statuses.includes(item.status));
      const offset = Number(url.searchParams.get("offset"));
      return Response.json({ items: items.slice(offset, offset + 2), next_offset: offset + 2 < items.length ? offset + 2 : null });
    }
    return Response.json({ name: titles[Number(path.split("/").at(-1)) - 1], poster_path: null, seasons: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function selectView(name: string) {
  fireEvent.click(screen.getByRole("button", { name, exact: true }));
}

it("opens In Progress and paginates the History group", async () => {
  const fetchMock = fixture();
  render(<Library token="token" />);
  await screen.findByText("Andor");
  await screen.findByText("Fargo");
  expect(screen.getByRole("button", { name: "In Progress", pressed: true })).toBeTruthy();
  selectView("Watchlist");
  await screen.findByText("Dune");
  selectView("History");
  await screen.findByText("Severance");
  await screen.findByText("Alien");
  fireEvent.click(screen.getByRole("button", { name: "Load more titles" }));
  await screen.findByText("Lost");
  expect(fetchMock.mock.calls.some(([input]) => String(input).includes("group=history&offset=2"))).toBe(true);
});

it("loads completed show progress only after expanding its checklist", async () => {
  const fetchMock = fixture();
  render(<Library token="token" />);
  selectView("History");
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
  const fetchMock = fixture();
  render(<Library token="token" />);
  selectView("Watchlist");
  fireEvent.click(await screen.findByRole("button", { name: "Actions for Dune" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove", exact: true }));
  expect(screen.getByRole("dialog", { name: "Remove saved title" })).toBeTruthy();
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByText("Dune")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Remove", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "Remove title" }));
  await waitFor(() => expect(screen.queryByText("Dune")).toBeNull());
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
});

it("opens the selected title using its media type and TMDB id", async () => {
  fixture();
  const open = vi.fn();
  render(<Library token="token" onOpenTitle={open} />);
  selectView("Watchlist");
  fireEvent.click(await screen.findByRole("button", { name: /Dune Movie/ }));
  expect(open).toHaveBeenCalledWith("movie", 1);
});

it("keeps the original status on failure and moves the title on success", async () => {
  const original = fixture();
  let fail = true;
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PATCH" && fail) {
      fail = false;
      return Promise.resolve(Response.json({ message: "Could not save status." }, { status: 503 }));
    }
    return original(input, init);
  }));
  render(<Library token="token" />);
  selectView("Watchlist");
  fireEvent.click(await screen.findByRole("button", { name: "Actions for Dune" }));
  const status = screen.getByRole("combobox", { name: "Status for Dune" }) as HTMLSelectElement;
  fireEvent.change(status, { target: { value: "watched" } });
  expect((await screen.findByRole("alert")).textContent).toContain("Could not save status");
  expect(status.value).toBe("watchlist");
  fireEvent.change(status, { target: { value: "watched" } });
  await screen.findByText("Your watchlist is empty");
  selectView("History");
  await screen.findByText("Dune");
});
