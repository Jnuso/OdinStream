// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import PostComposer from "../src/components/PostComposer";
import Profile from "../src/components/Profile";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.open = false;
  };
});

type Call = { path: string; method: string; body: unknown; authorization: string | null };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function stub(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const call = {
      path: url.pathname + url.search,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : null,
      authorization: new Headers(init?.headers).get("Authorization"),
    };
    calls.push(call);
    return handler(call);
  }));
  return calls;
}

const profile = {
  id: "author-1",
  display_name: "Ada Vance",
  handle: "adavance",
  bio: "Slow-burn dramas and sharp thrillers.",
  post_count: 2,
  follower_count: 5,
  following_count: 1,
  viewer_follows: false,
};

const postFixture = {
  id: "post-1",
  media_type: "movie" as const,
  tmdb_id: 27205,
  title_name: "Inception",
  poster_path: "/inception.jpg",
  release_date: "2010-07-15",
  rating: 5,
  review: "Perfect the second time too.",
  created_at: "2026-11-19T10:00:00Z",
  updated_at: "2026-11-19T10:00:00Z",
  author: { id: "author-1", display_name: "Ada Vance", handle: "adavance" },
};

const profileProps = {
  token: "test-token",
  viewerId: "viewer-1",
  reloadKey: 0,
  onOpenProfile: vi.fn(),
  onOpenTitle: vi.fn(),
  onEdit: vi.fn(),
  onChanged: vi.fn(),
  onOpenAccount: vi.fn(),
};

describe("profile screen", () => {
  it("shows identity, stats and the authored posts", async () => {
    stub((call) => call.path === "/api/profiles/author-1"
      ? json(profile)
      : json({ items: [postFixture] }));

    render(<Profile {...profileProps} profileId="author-1" />);

    expect(await screen.findByRole("heading", { name: "Ada Vance" })).toBeTruthy();
    expect(screen.getAllByText("@adavance").length).toBeGreaterThan(0);
    expect(screen.getByText("Slow-burn dramas and sharp thrillers.")).toBeTruthy();
    expect(screen.getByText("2", { selector: "strong" })).toBeTruthy();
    expect(await screen.findByText("Inception")).toBeTruthy();
    expect(screen.getByText("Ada’s ratings & reviews")).toBeTruthy();
    expect(screen.queryByText("Profile settings")).toBeNull();
  });

  it("follows another account and refreshes", async () => {
    const calls = stub((call) => {
      if (call.path === "/api/profiles/author-1") return json(profile);
      if (call.method === "PUT") return new Response(null, { status: 204 });
      return json({ items: [] });
    });
    render(<Profile {...profileProps} profileId="author-1" />);

    fireEvent.click(await screen.findByRole("button", { name: "+ Follow" }));
    await waitFor(() => expect(profileProps.onChanged).toHaveBeenCalled());
    expect(calls.filter((call) => call.method === "PUT")).toEqual([
      { path: "/api/profiles/author-1/follow", method: "PUT", body: null, authorization: "Bearer test-token" },
    ]);
  });

  it("resolves the me alias to the viewer and saves profile settings", async () => {
    const calls = stub((call) => {
      if (call.method === "PATCH") return json({ ...profile, id: "viewer-1", handle: "rues", bio: "Updated bio." });
      if (call.path === "/api/profiles/viewer-1") return json({ ...profile, id: "viewer-1", handle: "rue", bio: "" });
      return json({ items: [] });
    });

    render(<Profile {...profileProps} viewerId="viewer-1" profileId="me" />);

    expect(await screen.findByText("Profile settings")).toBeTruthy();
    const name = screen.getByLabelText("Display name") as HTMLInputElement;
    expect(name.value).toBe("Ada Vance");

    fireEvent.change(name, { target: { value: "Rue Okafor" } });
    fireEvent.change(screen.getByLabelText("Handle"), { target: { value: "rues" } });
    fireEvent.change(screen.getByLabelText("Bio"), { target: { value: "Updated bio." } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));

    expect(await screen.findByText("Profile saved.")).toBeTruthy();
    expect(calls.filter((call) => call.method === "PATCH")).toEqual([
      {
        path: "/api/me/profile",
        method: "PATCH",
        body: { display_name: "Rue Okafor", handle: "rues", bio: "Updated bio." },
        authorization: "Bearer test-token",
      },
    ]);
  });

  it("reports an unavailable profile", async () => {
    stub(() => json({ message: "Not found" }, 404));
    render(<Profile {...profileProps} profileId="missing" />);
    expect(await screen.findByText("This profile is unavailable.")).toBeTruthy();
  });
});

describe("post composer", () => {
  const composerProps = { token: "test-token", onClose: vi.fn(), onSaved: vi.fn() };

  it("publishes a rating and review for a searched title", async () => {
    const calls = stub((call) => {
      if (call.path.startsWith("/api/catalog/search")) {
        return json({ items: [{ id: 693134, media_type: "movie", name: "Dune: Part Two", release_date: "2024-02-27", overview: "", poster_path: "/dune.jpg" }] });
      }
      return json({ ...postFixture, id: "new-post" }, 201);
    });

    render(<PostComposer {...composerProps} />);
    fireEvent.change(screen.getByLabelText("Search movies and shows"), { target: { value: "dune" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    fireEvent.click(await screen.findByRole("button", { name: /Dune: Part Two/ }));
    fireEvent.click(screen.getByRole("radio", { name: "4 stars" }));
    fireEvent.change(screen.getByLabelText(/Your review/), { target: { value: "Bigger and stranger." } });
    fireEvent.click(screen.getByRole("button", { name: /Publish post/ }));

    await waitFor(() => expect(composerProps.onSaved).toHaveBeenCalledWith("Your post is live in the feed."));
    expect(calls.filter((call) => call.method === "POST")).toEqual([
      {
        path: "/api/titles/movie/693134/posts",
        method: "POST",
        body: { rating: 4, review: "Bigger and stranger." },
        authorization: "Bearer test-token",
      },
    ]);
  });

  it("requires a title and a rating before publishing", async () => {
    const calls = stub(() => json({ items: [] }));
    render(<PostComposer {...composerProps} />);

    fireEvent.click(screen.getByRole("button", { name: /Publish post/ }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Choose a title and a rating to share your post.",
    );
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);
    expect(composerProps.onSaved).not.toHaveBeenCalled();
  });

  it("edits an existing post without searching for a title", async () => {
    const calls = stub(() => json(postFixture));
    render(<PostComposer {...composerProps} post={{ ...postFixture, rating: 5 }} />);

    expect(screen.queryByLabelText("Search movies and shows")).toBeNull();
    fireEvent.change(screen.getByLabelText(/Your review/), { target: { value: "Rewatched it." } });
    fireEvent.click(screen.getByRole("button", { name: /Save changes/ }));

    await waitFor(() => expect(composerProps.onSaved).toHaveBeenCalledWith("Your post has been updated."));
    expect(calls.filter((call) => call.method === "PATCH")).toEqual([
      {
        path: "/api/posts/post-1",
        method: "PATCH",
        body: { rating: 5, review: "Rewatched it." },
        authorization: "Bearer test-token",
      },
    ]);
  });

  it("surfaces a save failure inside the dialog", async () => {
    stub((call) => (call.method === "PATCH"
      ? json({ message: "The post could not be saved." }, 503)
      : json(postFixture)));
    render(<PostComposer {...composerProps} post={postFixture} />);

    fireEvent.click(screen.getByRole("button", { name: /Save changes/ }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "The post could not be saved.");
    expect(composerProps.onSaved).not.toHaveBeenCalled();
  });
});
