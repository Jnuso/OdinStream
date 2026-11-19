// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import Discover from "../src/components/Discover";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("filters search using the signed-in user's saved services and keeps page navigation", async () => {
  const requests: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    requests.push(url.pathname + url.search);
    const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
    if (url.pathname === "/api/me/recommendations") return json({ items: [], basis: "popular" });
    if (url.pathname === "/api/catalog/search") return json({ items: [{ id: 1, media_type: "tv", name: "Any title", release_date: null }], page: 1, total_pages: 2 });
    if (url.pathname === "/api/me/catalog/search") return json({ items: [{ id: 2, media_type: "tv", name: "Available title", release_date: null }], page: Number(url.searchParams.get("page")), total_pages: 2 });
    throw new Error("Unexpected request");
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<Discover token="token" focus={null} onFocusHandled={() => {}} />);
  fireEvent.change(screen.getByLabelText("Search titles"), { target: { value: "show" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  expect(await screen.findByText("Any title")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Filter by my streaming services: Off" }));
  expect(await screen.findByText("Available title")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  await waitFor(() => expect(requests).toContain("/api/me/catalog/search?query=show&page=2"));
  expect(await screen.findByText(/Page 2 of 2/)).toBeTruthy();
});
