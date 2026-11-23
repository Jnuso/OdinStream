// @vitest-environment jsdom
import { clearCatalogCache } from "../src/data/catalogCache";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import Library from "../src/components/Library";
import { createLibraryCache } from "../src/data/libraryCache";

type Mark = { season_number: number; episode_number: number };
type Episode = { episode_number: number; name: string };

afterEach(() => { clearCatalogCache(); cleanup(); vi.unstubAllGlobals(); });

it("renders a preloaded library row before catalog details arrive", async () => {
  let finishCatalog!: (response: Response) => void;
  const catalog = new Promise<Response>(resolve => { finishCatalog = resolve; });
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    if (String(input).includes("/api/me/saved-titles?group=in-progress")) {
      return Promise.resolve(Response.json({ items: [{ id: "show", media_type: "tv", tmdb_id: 42, status: "watching" }] }));
    }
    if (String(input).endsWith("/episodes")) return Promise.resolve(Response.json({ items: [], last_watched: null }));
    return catalog;
  });
  vi.stubGlobal("fetch", fetchMock);
  const cache = createLibraryCache("test-token");
  const preload = cache.pages["in-progress"].load();
  expect(cache.pages["in-progress"].load()).toBe(preload);
  await preload;

  render(<Library token="test-token" cache={cache} />);
  expect(screen.getByText("Loading title details…")).toBeTruthy();
  expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/me/saved-titles?group=in-progress"))).toHaveLength(1);
  finishCatalog(Response.json({ name: "Ready to watch", poster_path: null, seasons: [] }));
  await screen.findByText("Ready to watch");
});

it("discards a pre-mutation response and keeps separate account caches", async () => {
  let finishPrevious!: (response: Response) => void;
  const fetchMock = vi.fn()
    .mockImplementationOnce(() => new Promise<Response>(resolve => { finishPrevious = resolve; }))
    .mockResolvedValueOnce(Response.json({ items: [], next_offset: 2 }))
    .mockResolvedValueOnce(Response.json({ items: [] }));
  vi.stubGlobal("fetch", fetchMock);
  const cache = createLibraryCache("first-token");
  const previous = cache.pages["in-progress"].load();
  cache.invalidate();
  await cache.pages["in-progress"].load();
  finishPrevious(Response.json({ items: [], next_offset: 1 }));
  await previous;
  expect(cache.pages["in-progress"].peek()?.next_offset).toBe(2);

  const other = createLibraryCache("second-token");
  expect(other.pages["in-progress"].peek()).toBeUndefined();
  await other.pages["in-progress"].load();
  expect(new Headers(fetchMock.mock.calls[2][1].headers).get("Authorization")).toBe("Bearer second-token");
});

function fixture(options: { episodes: Episode[] | null; missingSeason?: boolean; missingTitle?: boolean; failDelete?: boolean; lastWatched?: Mark }) {
  let watched: Mark[] = [
    { season_number: 1, episode_number: 1 },
    { season_number: 1, episode_number: 2 },
    { season_number: 2, episode_number: 1 },
  ];
  const requests: { path: string; method: string; authorization: string | null }[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), "http://localhost").pathname;
    const method = init?.method ?? "GET";
    requests.push({ path, method, authorization: new Headers(init?.headers).get("Authorization") });
    if (path === "/api/me/saved-titles") return json({ items: [{ id: "saved-show", media_type: "tv", tmdb_id: 42, status: "watching" }] });
    if (path === "/api/catalog/tv/42") {
      if (options.missingTitle) return json({ message: "Catalog unavailable" }, 503);
      return json({ name: "Show", seasons: options.missingSeason ? [] : [{ season_number: 1, name: "Season 1", episode_count: 3 }] });
    }
    if (path === "/api/catalog/tv/42/seasons/1") {
      return options.episodes === null ? json({ message: "Catalog unavailable" }, 503) : json({ episodes: options.episodes });
    }
    if (path === "/api/me/saved-titles/saved-show/episodes") return json({ items: watched, last_watched: options.lastWatched ?? watched.at(-1) ?? null });
    const match = path.match(/^\/api\/me\/saved-titles\/saved-show\/seasons\/(\d+)\/episodes\/(\d+)$/);
    if (method === "DELETE" && match) {
      if (options.failDelete) return json({ message: "Could not remove episode" }, 503);
      watched = watched.filter(item => item.season_number !== Number(match[1]) || item.episode_number !== Number(match[2]));
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { requests, marks: () => watched };
}

async function openSeason(name: string) {
  fireEvent.click(await screen.findByRole("button", { name: "Episode progress" }));
  fireEvent.click(await screen.findByRole("button", { name }));
}

async function removeOnlyEpisodeOne(state: ReturnType<typeof fixture>) {
  const checkbox = await screen.findByRole("checkbox", { name: "Episode 1 (E1) · saved progress, details unavailable" }) as HTMLInputElement;
  expect(checkbox.checked).toBe(true);
  fireEvent.click(checkbox);
  await waitFor(() => expect(state.requests.filter(request => request.method === "DELETE")).toEqual([
    { path: "/api/me/saved-titles/saved-show/seasons/1/episodes/1", method: "DELETE", authorization: "Bearer test-token" },
  ]));
  await waitFor(() => expect(screen.queryByRole("checkbox", { name: "Episode 1 (E1) · saved progress, details unavailable" })).toBeNull());
  expect(state.marks()).toEqual([{ season_number: 1, episode_number: 2 }, { season_number: 2, episode_number: 1 }]);
  expect((screen.getByRole("checkbox", { name: /Episode 2 \(E2\)/ }) as HTMLInputElement).checked).toBe(true);
  expect(screen.getByText(/2 episodes marked watched/)).toBeTruthy();
}

describe("saved TV episode progress", () => {
  it("uses the most recently marked episode rather than the furthest episode", async () => {
    fixture({ episodes: [{ episode_number: 1, name: "First" }, { episode_number: 2, name: "Second" }, { episode_number: 3, name: "Third" }], lastWatched: { season_number: 1, episode_number: 1 } });
    render(<Library token="test-token" />);
    fireEvent.click(await screen.findByRole("button", { name: "Episode progress" }));
    expect((await screen.findByText(/Last watched: S1 E1\. Next: S1 E2/)).textContent).toContain("Second");
  });

  it("merges an omitted saved episode into the TMDB list and removes it individually", async () => {
    const state = fixture({ episodes: [{ episode_number: 2, name: "Known episode" }, { episode_number: 3, name: "Third episode" }] });
    render(<Library token="test-token" />);
    await openSeason("Season 1");
    await screen.findByRole("checkbox", { name: "Known episode (E2)" });
    expect(screen.getAllByRole("checkbox").map(item => item.parentElement?.textContent?.trim())).toEqual([
      "Episode 1 (E1) · saved progress, details unavailable", "Known episode (E2)", "Third episode (E3)",
    ]);
    const checkbox = screen.getByRole("checkbox", { name: "Episode 1 (E1) · saved progress, details unavailable" }) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    await waitFor(() => expect(screen.queryByRole("checkbox", { name: "Episode 1 (E1) · saved progress, details unavailable" })).toBeNull());
    expect(state.requests.filter(request => request.method === "DELETE")).toEqual([
      { path: "/api/me/saved-titles/saved-show/seasons/1/episodes/1", method: "DELETE", authorization: "Bearer test-token" },
    ]);
    expect(state.marks()).toEqual([{ season_number: 1, episode_number: 2 }, { season_number: 2, episode_number: 1 }]);
    expect((screen.getByRole("checkbox", { name: "Known episode (E2)" }) as HTMLInputElement).checked).toBe(true);
  });

  it("keeps saved episodes removable when TMDB returns an empty season", async () => {
    const state = fixture({ episodes: [] });
    render(<Library token="test-token" />);
    await openSeason("Season 1");
    await screen.findByText("Season 1 · 0 of 0 listed episodes watched");
    expect((screen.getByRole("button", { name: "Mark season watched" }) as HTMLButtonElement).disabled).toBe(true);
    await removeOnlyEpisodeOne(state);
  });

  it("retains the saved selection when an individual removal fails", async () => {
    const state = fixture({ episodes: null, failDelete: true });
    render(<Library token="test-token" />);
    await openSeason("Season 1");
    await screen.findByText("Catalog unavailable");
    const checkbox = await screen.findByRole("checkbox", { name: "Episode 1 (E1) · saved progress, details unavailable" }) as HTMLInputElement;
    fireEvent.click(checkbox);
    expect((await screen.findByRole("alert")).textContent).toBe("Could not remove episode");
    expect((screen.getByRole("checkbox", { name: "Episode 1 (E1) · saved progress, details unavailable" }) as HTMLInputElement).checked).toBe(true);
    expect(state.marks()).toEqual([
      { season_number: 1, episode_number: 1 },
      { season_number: 1, episode_number: 2 },
      { season_number: 2, episode_number: 1 },
    ]);
  });

  it.each([
    { missingTitle: false, missingSeason: false, label: "unavailable episode metadata", season: "Season 1" },
    { missingTitle: false, missingSeason: true, label: "an omitted season", season: "Season 1 (saved progress)" },
    { missingTitle: true, missingSeason: false, label: "unavailable title metadata", season: "Season 1 (saved progress)" },
  ])("keeps saved episodes removable with $label", async ({ missingTitle, missingSeason, season }) => {
    const state = fixture({ episodes: null, missingTitle, missingSeason });
    render(<Library token="test-token" />);
    await openSeason(season);
    expect((await screen.findByRole("alert")).textContent).toBe("Catalog unavailable");
    await removeOnlyEpisodeOne(state);
    const seasonTwo = screen.getByRole("button", { name: "Season 2 (saved progress)" });
    expect(within(seasonTwo).getByText("Season 2 (saved progress)")).toBeTruthy();
  });
});
