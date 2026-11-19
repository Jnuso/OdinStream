// @vitest-environment jsdom
import { clearCatalogCache } from "../src/data/catalogCache";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ShowProgress from "../src/components/ShowProgress";

afterEach(() => { clearCatalogCache(); cleanup(); vi.unstubAllGlobals(); });
const entry = { id: "show", tmdb_id: 42, title: { seasons: [{ season_number: 1, name: "Season 1", episode_count: 3 }] } };

it("shows next episode collapsed and updates a checkbox without clearing or reloading the list", async () => {
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  let marked = false;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), "http://localhost").pathname;
    if (init?.method === "PUT") { await pending; marked = true; return new Response(null, { status: 204 }); }
    if (path.includes("/api/catalog/")) return new Response(JSON.stringify({ episodes: [1, 2, 3].map(number => ({ episode_number: number, name: `Chapter ${number}` })) }));
    return new Response(JSON.stringify({ items: [{ season_number: 1, episode_number: 1 }, ...(marked ? [{ season_number: 1, episode_number: 2 }] : [])], last_watched: { season_number: 1, episode_number: marked ? 2 : 1 } }));
  });
  vi.stubGlobal("fetch", fetchMock);
  const view = render(<ShowProgress entry={entry} token="token" expanded={false} />);
  expect(await screen.findByText("Next: S1 E2 · Chapter 2")).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Episode progress" })).toBeNull();
  view.rerender(<ShowProgress entry={entry} token="token" expanded />);
  fireEvent.click(screen.getByRole("button", { name: "Season 1" }));
  const checkbox = await screen.findByRole("checkbox", { name: "Chapter 2 (E2)" }) as HTMLInputElement;
  fireEvent.click(checkbox);
  expect(checkbox.checked).toBe(true);
  expect(checkbox.disabled).toBe(false);
  expect(screen.getByText("Next: S1 E2 · Chapter 2")).toBeTruthy();
  expect(screen.queryByText("Loading episodes…")).toBeNull();
  expect(screen.getByRole("checkbox", { name: "Chapter 3 (E3)" })).toBeTruthy();
  await act(async () => finish());
  await screen.findByText("Next: S1 E3 · Chapter 3");
  expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/catalog/"))).toHaveLength(1);
});

it("offers the first main-season episode for a show that has not been started", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(String(input).includes("/api/catalog/")
    ? { episodes: [{ episode_number: 1, name: "Pilot" }] }
    : { items: [], last_watched: null }))));
  render(<ShowProgress entry={entry} token="token" expanded={false} />);
  await waitFor(() => expect(screen.getByText("Next: S1 E1 · Pilot")).toBeTruthy());
});

it("keeps next-episode details inside the expanded progress for completed shows", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(String(input).includes("/api/catalog/")
    ? { episodes: [{ episode_number: 1, name: "Pilot" }] }
    : { items: [], last_watched: null }))));
  const completed = { ...entry, status: "completed" };
  const view = render(<ShowProgress entry={completed} token="token" expanded={false} />);
  expect(screen.queryByText(/Next:/)).toBeNull();
  view.rerender(<ShowProgress entry={completed} token="token" expanded />);
  expect(await screen.findByText(/Next: S1 E1 · Pilot/)).toBeTruthy();
});
