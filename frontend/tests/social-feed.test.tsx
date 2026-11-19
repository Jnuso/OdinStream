// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import Feed from "../src/components/Feed";
import PostList from "../src/components/PostList";
import type { Post } from "../src/data/social";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// jsdom has no modal dialog implementation.
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

function post(overrides: Partial<Post> = {}): Post {
  return {
    id: "post-1",
    media_type: "movie",
    tmdb_id: 27205,
    title_name: "Inception",
    poster_path: "/inception.jpg",
    release_date: "2010-07-15",
    rating: 4,
    review: "Still the tightest heist movie ever built.",
    created_at: "2026-11-19T10:00:00Z",
    updated_at: "2026-11-19T10:00:00Z",
    author: { id: "author-1", display_name: "Ada Vance", handle: "adavance" },
    ...overrides,
  };
}

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

const feedProps = {
  token: "test-token",
  viewerId: "author-1",
  onOpenProfile: vi.fn(),
  onOpenTitle: vi.fn(),
  onEdit: vi.fn(),
  onNewPost: vi.fn(),
};

describe("feed", () => {
  it("renders posts returned by the following feed", async () => {
    const calls = stub(() => json({ items: [post()] }));
    render(<Feed {...feedProps} scope="following" onScope={vi.fn()} reloadKey={0} />);

    expect(await screen.findByText("Inception")).toBeTruthy();
    expect(screen.getByText("Ada Vance")).toBeTruthy();
    expect(screen.getByText("@adavance")).toBeTruthy();
    expect(screen.getByText("Movie · 2010")).toBeTruthy();
    expect(screen.getByText("Still the tightest heist movie ever built.")).toBeTruthy();
    expect(screen.getByLabelText("4 out of 5 stars")).toBeTruthy();
    expect(calls).toEqual([
      { path: "/api/feed?scope=following&limit=30&offset=0", method: "GET", body: null, authorization: "Bearer test-token" },
    ]);
  });

  it("switches scope through the parent, not locally", async () => {
    stub(() => json({ items: [post()] }));
    const onScope = vi.fn();
    render(<Feed {...feedProps} scope="following" onScope={onScope} reloadKey={0} />);
    await screen.findByText("Inception");

    fireEvent.click(screen.getByRole("button", { name: "Public" }));
    expect(onScope).toHaveBeenCalledWith("public");
    expect(screen.getByRole("button", { name: "Following" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("explains an empty following feed and offers the public feed", async () => {
    stub(() => json({ items: [] }));
    const onScope = vi.fn();
    render(<Feed {...feedProps} scope="following" onScope={onScope} reloadKey={0} />);

    expect(await screen.findByText("Your following feed is empty.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Explore the public feed/ }));
    expect(onScope).toHaveBeenCalledWith("public");
  });

  it("surfaces a failed load and retries it", async () => {
    let attempts = 0;
    const calls = stub(() => {
      attempts += 1;
      return attempts === 1 ? json({ message: "Catalog unavailable" }, 503) : json({ items: [post()] });
    });
    render(<Feed {...feedProps} scope="public" onScope={vi.fn()} reloadKey={0} />);

    expect(await screen.findByText("The feed is unavailable.")).toBeTruthy();
    expect(screen.getByText("Catalog unavailable")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Inception")).toBeTruthy();
    expect(calls.filter((call) => call.path.startsWith("/api/feed"))).toHaveLength(2);
  });

  it("reloads the feed when reloadKey changes", async () => {
    const calls = stub(() => json({ items: [post()] }));
    const { rerender } = render(<Feed {...feedProps} scope="public" onScope={vi.fn()} reloadKey={0} />);
    await screen.findByText("Inception");

    rerender(<Feed {...feedProps} scope="public" onScope={vi.fn()} reloadKey={1} />);
    await waitFor(() => expect(calls.filter((call) => call.path.startsWith("/api/feed"))).toHaveLength(2));
  });
});

describe("post list", () => {
  const listProps = {
    token: "test-token",
    viewerId: "author-1",
    empty: <p>Nothing here</p>,
    onOpenProfile: vi.fn(),
    onOpenTitle: vi.fn(),
    onEdit: vi.fn(),
    onChanged: vi.fn(),
  };

  it("shows the empty slot when there are no posts", () => {
    render(<PostList {...listProps} posts={[]} />);
    expect(screen.getByText("Nothing here")).toBeTruthy();
  });

  it("opens the title and the author from a post card", async () => {
    stub(() => json({}));
    render(<PostList {...listProps} posts={[post({ author: { id: "other", display_name: "Rue Okafor", handle: "rue" } })]} />);

    fireEvent.click(screen.getByRole("button", { name: "Open Inception details" }));
    expect(listProps.onOpenTitle).toHaveBeenCalledWith("movie", 27205);

    fireEvent.click(screen.getByRole("button", { name: /View profile/ }));
    expect(listProps.onOpenProfile).toHaveBeenCalledWith("other");
  });

  it("keeps edit and delete on the viewer's own post", () => {
    render(<PostList {...listProps} posts={[post()]} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit post" }));
    expect(listProps.onEdit).toHaveBeenCalledWith(post());
    expect(screen.queryByRole("button", { name: /View profile/ })).toBeNull();
  });

  it("deletes a post after confirmation and refreshes the list", async () => {
    const calls = stub(() => new Response(null, { status: 204 }));
    render(<PostList {...listProps} posts={[post()]} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText("Delete this post?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete post" }));
    await waitFor(() => expect(listProps.onChanged).toHaveBeenCalled());
    expect(calls).toEqual([
      { path: "/api/posts/post-1", method: "DELETE", body: null, authorization: "Bearer test-token" },
    ]);
  });

  it("keeps the dialog open and explains a failed delete", async () => {
    stub(() => json({ message: "The post could not be deleted." }, 503));
    render(<PostList {...listProps} posts={[post()]} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete post" }));

    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "The post could not be deleted.");
    expect(screen.getByText("Delete this post?")).toBeTruthy();
    expect(listProps.onChanged).not.toHaveBeenCalled();
  });
});
