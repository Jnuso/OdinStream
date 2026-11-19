import { afterEach, expect, it, vi } from "vitest";
import { cachedCatalog, clearCatalogCache } from "../src/data/catalogCache";

afterEach(() => { clearCatalogCache(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("shares in-flight public metadata requests and expires successful responses after five minutes", async () => {
  let now = 1000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ name: "A show" })));
  vi.stubGlobal("fetch", fetchMock);
  const path = "/api/catalog/tv/42";
  const first = cachedCatalog(path);
  const second = cachedCatalog(path);
  await Promise.all([first, second]);
  expect(fetchMock).toHaveBeenCalledOnce();
  now += 299999;
  await cachedCatalog(path);
  expect(fetchMock).toHaveBeenCalledOnce();
  now += 1;
  await cachedCatalog(path);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("retries failed requests and rejects account-owned paths", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ message: "Unavailable" }), { status: 503 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ name: "A show" })));
  vi.stubGlobal("fetch", fetchMock);
  await expect(cachedCatalog("/api/catalog/tv/42")).rejects.toThrow("Unavailable");
  await expect(cachedCatalog("/api/catalog/tv/42")).resolves.toEqual({ name: "A show" });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(() => cachedCatalog("/api/me/saved-titles")).toThrow("Only public catalog paths");
});
