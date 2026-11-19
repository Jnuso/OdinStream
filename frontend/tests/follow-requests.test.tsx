// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import FollowRequests from "../src/components/FollowRequests";
import { useFollowRequests } from "../src/data/useFollowRequests";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const changed = vi.fn();
const open = vi.fn();
function Harness({ owner = "me" }: { owner?: string }) {
  const model = useFollowRequests(owner, owner, true, 0, changed);
  return <FollowRequests model={model} onOpenProfile={open} />;
}
const people = [
  { user_id: "maya", display_name: "Maya", handle: "maya.watches", created_at: "2026-11-19T12:00:00Z" },
  { user_id: "leo", display_name: "Leo", handle: "leo", created_at: "2026-11-19T13:00:00Z" },
];
function fixture({ fail = false, paginated = false } = {}) {
  let items = [...people];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    if (init?.method === "POST") {
      if (fail) return new Response(JSON.stringify({ message: "Could not save this request." }), { status: 503 });
      items = items.filter(item => !url.pathname.includes(`/${item.user_id}/`));
      return new Response(null, { status: 204 });
    }
    const offset = Number(url.searchParams.get("offset") ?? 0);
    return new Response(JSON.stringify({ items: paginated ? items.slice(offset, offset + 1) : items, next_offset: paginated && offset + 1 < items.length ? offset + 1 : null }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

it("approves and declines requests, updating the badge until none remain", async () => {
  const fetchMock = fixture(); render(<Harness />);
  await screen.findByRole("img", { name: "2 pending follow requests" });
  fireEvent.click(screen.getByRole("button", { name: "Approve Maya" }));
  await screen.findByRole("img", { name: "1 pending follow request" });
  expect(screen.queryByRole("button", { name: "Approve Maya" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Decline Leo" }));
  await screen.findByText("No pending follow requests.");
  expect(screen.queryByRole("img")).toBeNull();
  expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/maya/approve") && init?.method === "POST")).toBe(true);
  expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/leo/decline") && init?.method === "POST")).toBe(true);
});

it("retains a request and its count when approval fails", async () => {
  fixture({ fail: true }); render(<Harness />);
  fireEvent.click(await screen.findByRole("button", { name: "Approve Maya" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Could not save");
  expect(screen.getByRole("button", { name: "Approve Maya" })).toBeTruthy();
  expect(screen.getByRole("img", { name: "2 pending follow requests" })).toBeTruthy();
});

it("loads additional requests and opens requester profiles", async () => {
  const fetchMock = fixture({ paginated: true }); render(<Harness />);
  await screen.findByRole("img", { name: "1 or more pending follow request" });
  fireEvent.click(screen.getByRole("button", { name: "More requests" }));
  await screen.findByRole("button", { name: "Approve Leo" });
  expect(screen.getByRole("img", { name: "2 pending follow requests" })).toBeTruthy();
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes("offset=1"))).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: /Maya @maya.watches/ }));
  expect(open).toHaveBeenCalledWith("maya");
});

it("clears another account's requests immediately on account change", async () => {
  const original = fixture();
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { finish = resolve; });
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => new Headers(init?.headers).get("Authorization") === "Bearer other" ? pending : original(input, init)));
  const view = render(<Harness />);
  await screen.findByRole("button", { name: "Approve Maya" });
  view.rerender(<Harness owner="other" />);
  expect(screen.queryByRole("button", { name: "Approve Maya" })).toBeNull();
  expect(screen.queryByRole("img")).toBeNull();
  await act(async () => finish(new Response(JSON.stringify({ items: [], next_offset: null }))));
  await waitFor(() => expect(screen.getByText("No pending follow requests.")).toBeTruthy());
});
