// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import Setup from "../src/components/Setup";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("account setup", () => {
  it("requires a username and privacy, then saves optional choices with capitalization", async () => {
    const fetchMock = vi.fn(async (_url: string, _options: RequestInit) =>
      new Response(JSON.stringify({ setup_complete: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const complete = vi.fn();
    render(<Setup token="token" onComplete={complete} onSignOut={() => {}} />);
    const username = screen.getByLabelText("Username (required)") as HTMLInputElement;
    const form = username.closest("form")!;
    expect(form.checkValidity()).toBe(false);
    fireEvent.change(username, { target: { value: "Jack" } });
    expect(form.checkValidity()).toBe(false);
    fireEvent.click(screen.getByRole("radio", { name: /^Private/ }));
    expect(form.checkValidity()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText(/Comedy/));
    fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));
    await waitFor(() => expect(complete).toHaveBeenCalledOnce());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      username: "Jack", visibility: "private", favorite_genres: ["Comedy"], streaming_services: [],
      favorite_titles: [], favorite_people: [],
    });
  });

  it("displays a taken username and leaves setup open", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: "duplicate_handle", message: "That username is already taken.",
    }), { status: 409 })));
    const complete = vi.fn();
    render(<Setup token="token" onComplete={complete} onSignOut={() => {}} />);
    fireEvent.change(screen.getByLabelText("Username (required)"), { target: { value: "jack" } });
    fireEvent.click(screen.getByRole("radio", { name: /^Public/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByLabelText(/Comedy/));
    fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));
    expect((await screen.findByRole("alert")).textContent).toContain("already taken");
    expect(screen.getByLabelText("Username (required)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect((screen.getByLabelText(/Comedy/) as HTMLInputElement).checked).toBe(true);
    expect(complete).not.toHaveBeenCalled();
  });

  it("keeps more than three favorites, distinguishes movies from shows, and supports removal", async () => {
    const fetchMock = vi.fn(async (path: string, _options: RequestInit) => {
      if (path.includes("/people/search")) return Response.json({ items: [{ id: 1, name: "A Director" }] });
      if (path.includes("/catalog/search")) return Response.json({
        items: [
          { id: 1, name: "Shared name", media_type: "movie" },
          { id: 1, name: "Shared name", media_type: "tv" },
          { id: 2, name: "Another film", media_type: "movie" },
          { id: 3, name: "A third film", media_type: "movie" },
        ],
      });
      return Response.json({ setup_complete: true });
    });
    vi.stubGlobal("fetch", fetchMock);
    const complete = vi.fn();
    render(<Setup token="token" onComplete={complete} onSignOut={() => {}} />);
    fireEvent.change(screen.getByLabelText("Username (required)"), { target: { value: "Jack" } });
    fireEvent.click(screen.getByRole("radio", { name: /^Private/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "film" } });
    for (const button of await screen.findAllByRole("button", { name: /^Add / })) fireEvent.click(button);
    fireEvent.change(screen.getByLabelText("Search for"), { target: { value: "people" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "director" } });
    fireEvent.click(await screen.findByRole("button", { name: "Add A Director" }));
    fireEvent.click(screen.getByRole("button", { name: /Remove A third film/ }));
    fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));
    await waitFor(() => expect(complete).toHaveBeenCalledOnce());
    const body = JSON.parse(fetchMock.mock.calls.find(([path]) => path.endsWith("/api/me/setup"))![1].body as string);
    expect(body.favorite_titles).toEqual([{ media_type: "movie", id: 1 }, { media_type: "tv", id: 1 }, { media_type: "movie", id: 2 }]);
    expect(body.favorite_people).toEqual([1]);
  });

  it("can skip personalization after a search failure and recover from a completed save", async () => {
    const fetchMock = vi.fn(async (path: string, _options: RequestInit) => path.includes("/catalog/")
      ? Response.json({ message: "Search unavailable." }, { status: 503 })
      : Response.json({ error: "setup_already_complete" }, { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);
    const complete = vi.fn();
    render(<Setup token="token" onComplete={complete} onSignOut={() => {}} />);
    fireEvent.change(screen.getByLabelText("Username (required)"), { target: { value: "Jack" } });
    fireEvent.click(screen.getByRole("radio", { name: /^Private/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByLabelText(/Comedy/));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "film" } });
    expect((await screen.findByRole("alert")).textContent).toContain("Search unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    await waitFor(() => expect(complete).toHaveBeenCalledOnce());
    const body = JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string);
    expect(body.favorite_genres).toEqual([]);
    expect(body.favorite_titles).toEqual([]);
  });
});
