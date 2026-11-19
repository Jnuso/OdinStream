// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import PostComposer from "../src/components/PostComposer";

const title = { id: 603, media_type: "movie" as const, name: "The Matrix", poster_path: null, release_date: "1999-03-31", overview: "" };
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("publishes the preselected title with a numeric half-star rating", async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "post" }), { status: 201 }));
  vi.stubGlobal("fetch", fetchMock);
  const saved = vi.fn();
  render(<PostComposer token="token" initialTitle={title} onClose={() => {}} onSaved={saved} />);
  expect(screen.getByText("The Matrix")).toBeTruthy();
  expect(screen.queryByLabelText("Search movies and shows")).toBeNull();
  fireEvent.click(screen.getByRole("radio", { name: "4.5 stars" }));
  fireEvent.change(screen.getByLabelText(/Your review/), { target: { value: " Still great. " } });
  fireEvent.click(screen.getByRole("button", { name: /Publish post/ }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(fetchMock.mock.calls[0][0]).toContain("/api/titles/movie/603/posts");
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ rating: 4.5, review: "Still great." });
});

it("can change the preselected title without losing the review draft", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [{ ...title, id: 604, name: "Another movie" }] }))));
  render(<PostComposer token="token" initialTitle={title} onClose={() => {}} onSaved={() => {}} />);
  fireEvent.change(screen.getByLabelText(/Your review/), { target: { value: "My draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Change" }));
  fireEvent.change(screen.getByLabelText("Search movies and shows"), { target: { value: "Another" } });
  fireEvent.click(screen.getByRole("button", { name: "Search", exact: true }));
  fireEvent.click(await screen.findByRole("button", { name: /Another movie/ }));
  expect(screen.getByText("Another movie")).toBeTruthy();
  expect((screen.getByLabelText(/Your review/) as HTMLTextAreaElement).value).toBe("My draft");
});

it("keeps the draft available if publishing fails", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "Please try again." }), { status: 503 })));
  const saved = vi.fn();
  render(<PostComposer token="token" initialTitle={title} onClose={() => {}} onSaved={saved} />);
  fireEvent.click(screen.getByRole("radio", { name: "4 stars" }));
  fireEvent.change(screen.getByLabelText(/Your review/), { target: { value: "My draft" } });
  fireEvent.click(screen.getByRole("button", { name: /Publish post/ }));
  expect((await screen.findByRole("alert")).textContent).toContain("try again");
  expect((screen.getByLabelText(/Your review/) as HTMLTextAreaElement).value).toBe("My draft");
  expect(saved).not.toHaveBeenCalled();
});
