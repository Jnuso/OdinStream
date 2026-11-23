// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Session } from "@supabase/supabase-js";
import Account from "../src/components/Account";
import { createPreferencesCache } from "../src/data/preferencesCache";

vi.mock("../src/data/auth", () => ({ supabase: { auth: { signOut: vi.fn().mockResolvedValue({ error: null }) } } }));

type Preferences = { favorite_genres: string[]; streaming_services: string[] };
const session = (id: string, token = id) => ({ user: { id, email: `${id}@example.test` }, access_token: token }) as Session;
const props = { recovery: false, callbackError: null, onClearCallbackError: () => {}, onRecoveryComplete: () => {}, onDeleted: () => {} };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("opens with preloaded preferences and caches the server-confirmed save", async () => {
  const initial = { favorite_genres: ["Drama"], streaming_services: [] };
  const updated = { favorite_genres: ["Drama", "Comedy"], streaming_services: [] };
  const preferencesFetch = vi.fn()
    .mockResolvedValueOnce(response(initial))
    .mockResolvedValueOnce(response(updated));
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => String(input).endsWith("/streaming-services")
    ? Promise.resolve(response({}, 503))
    : preferencesFetch());
  const preferencesCache = createPreferencesCache("a");
  await preferencesCache.load();
  const view = render(<Account {...props} session={session("a")} preferencesCache={preferencesCache} />);
  expect((screen.getByRole("checkbox", { name: "Drama" }) as HTMLInputElement).checked).toBe(true);
  expect(preferencesFetch).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("checkbox", { name: "Comedy" }));
  fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
  await screen.findByText("Preferences saved.");
  view.unmount();
  render(<Account {...props} session={session("a")} preferencesCache={preferencesCache} />);
  expect((screen.getByRole("checkbox", { name: "Comedy" }) as HTMLInputElement).checked).toBe(true);
  expect(preferencesFetch).toHaveBeenCalledTimes(2);
});

it("loads, saves, and reloads preferences separately for each account", async () => {
  const stored: Record<string, Preferences> = {
    a: { favorite_genres: ["Drama"], streaming_services: ["Hulu"] },
    b: { favorite_genres: [], streaming_services: [] },
  };
  const requests: { token: string; method: string; body?: Preferences }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const token = new Headers(init?.headers).get("Authorization")?.replace("Bearer ", "") ?? "";
    const user = token === "refreshed-a" ? "a" : token;
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) as Preferences : undefined;
    requests.push({ token, method, body });
    if (body) stored[user] = body;
    return response(stored[user]);
  }));
  const view = render(<Account {...props} session={session("a")} />);
  expect((await screen.findByRole("checkbox", { name: "Drama" }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole("checkbox", { name: "Hulu" }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "Comedy" }));
  view.rerender(<Account {...props} session={session("a", "refreshed-a")} />);
  expect((screen.getByRole("checkbox", { name: "Comedy" }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "Hulu" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Netflix" }));
  fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
  await screen.findByText("Preferences saved.");
  expect(requests.at(-1)).toEqual({ token: "refreshed-a", method: "PUT", body: { favorite_genres: ["Drama", "Comedy"], streaming_services: ["Netflix"] } });
  view.rerender(<Account {...props} session={null} />);
  expect(screen.queryByText("Account preferences")).toBeNull();
  view.rerender(<Account {...props} session={session("b")} />);
  await screen.findByText(/Choose favorites/);
  expect((screen.getByRole("checkbox", { name: "Drama" }) as HTMLInputElement).checked).toBe(false);
  view.rerender(<Account {...props} session={session("a")} />);
  await waitFor(() => expect((screen.getByRole("checkbox", { name: "Comedy" }) as HTMLInputElement).checked).toBe(true));
  expect((screen.getByRole("checkbox", { name: "Netflix" }) as HTMLInputElement).checked).toBe(true);
});

it("allows a failed load to be retried without showing empty values as saved", async () => {
  let attempts = 0;
  vi.stubGlobal("fetch", vi.fn(async () => ++attempts === 1
    ? response({ message: "Preferences unavailable" }, 503)
    : response({ favorite_genres: ["Action"], streaming_services: [] })));
  render(<Account {...props} session={session("a")} />);
  expect((await screen.findByRole("alert")).textContent).toBe("Preferences unavailable");
  expect(screen.queryByRole("button", { name: "Save preferences" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry loading preferences" }));
  expect((await screen.findByRole("checkbox", { name: "Action" }) as HTMLInputElement).checked).toBe(true);
});

it("keeps edits visible and reports a failed save", async () => {
  vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === "PUT"
    ? response({ message: "Save failed" }, 503)
    : response({ favorite_genres: [], streaming_services: [] })));
  render(<Account {...props} session={session("a")} />);
  const comedy = await screen.findByRole("checkbox", { name: "Comedy" }) as HTMLInputElement;
  fireEvent.click(comedy);
  fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Save failed");
  expect(comedy.checked).toBe(true);
  expect(screen.queryByText("Preferences saved.")).toBeNull();
});

it("requires explicit confirmation and password before deleting an account", async () => {
  const deleted = vi.fn();
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === "DELETE"
    ? new Response(null, { status: 204 })
    : response({ favorite_genres: [], streaming_services: [] }));
  vi.stubGlobal("fetch", fetchMock);
  render(<Account {...props} onDeleted={deleted} session={session("a", "delete-token")} />);
  await screen.findByText("Delete account");
  const deleteButton = screen.getByRole("button", { name: "Permanently delete account" });
  expect((deleteButton as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "password" } });
  fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), { target: { value: "DELETE" } });
  fireEvent.click(deleteButton);
  await waitFor(() => expect(deleted).toHaveBeenCalledOnce());
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE" && init.body === JSON.stringify({ password: "password" }))).toBe(true);
});

it("expands the ranked services and saves a selection from the full list", async () => {
  const items = ["Netflix", "Max", "Hulu", "Disney+", "Prime Video", "Apple TV+", "Peacock", "Paramount+", "Crunchyroll"];
  const initial = { favorite_genres: [], streaming_services: [] };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/streaming-services")) return response({ items });
    return response(init?.body ? JSON.parse(String(init.body)) : initial);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<Account {...props} session={session("a")} />);
  const expand = await screen.findByRole("button", { name: "See more services" });
  expect(screen.queryByRole("checkbox", { name: "Crunchyroll" })).toBeNull();
  fireEvent.click(expand);
  fireEvent.click(screen.getByRole("checkbox", { name: "Crunchyroll" }));
  fireEvent.click(screen.getByRole("button", { name: "See fewer services" }));
  expect((screen.getByRole("checkbox", { name: "Crunchyroll" }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
  await screen.findByText("Preferences saved.");
  expect(fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")?.[1]?.body).toBe(
    JSON.stringify({ ...initial, streaming_services: ["Crunchyroll"] }),
  );
});
