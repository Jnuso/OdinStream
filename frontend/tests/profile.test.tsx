// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import Profile from "../src/components/Profile";

const profile = { id: "me", display_name: "Raif", handle: "RaifR", bio: "", post_count: 0, follower_count: 0, following_count: 0, viewer_follows: false, visibility: "private" };
const changed = vi.fn();
const props = { token: "token", viewerId: "me", profileId: "me", reloadKey: 0, onOpenProfile: vi.fn(), onOpenTitle: vi.fn(), onEdit: vi.fn(), onChanged: changed, onOpenAccount: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mockApi(failSave = false) {
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === "PATCH" && failSave) return new Response(JSON.stringify({ message: "That handle is taken." }), { status: 409 });
    return new Response(JSON.stringify(url.endsWith("/posts") ? { items: [] } : profile), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

it("leaves empty bios blank and opens settings only on request", async () => {
  mockApi(); render(<Profile {...props} />);
  await screen.findByRole("button", { name: "Edit profile" });
  expect(screen.queryByText(/Add a short bio|No bio yet/)).toBeNull();
  expect(screen.queryByLabelText("Display name")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
  expect((screen.getByLabelText("Bio") as HTMLTextAreaElement).value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Close Edit profile" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("saves edited profile values and closes the dialog", async () => {
  const fetchMock = mockApi(); render(<Profile {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: "Edit profile" }));
  fireEvent.change(screen.getByLabelText("Bio"), { target: { value: "Movie nights" } });
  fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(screen.queryByRole("dialog")).toBeNull();
  const patch = fetchMock.mock.calls.find(([, options]) => options?.method === "PATCH");
  expect(JSON.parse(patch![1]!.body as string)).toEqual({ display_name: "Raif", handle: "RaifR", bio: "Movie nights" });
});

it("keeps edits open when saving fails", async () => {
  mockApi(true); render(<Profile {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: "Edit profile" }));
  fireEvent.change(screen.getByLabelText("Bio"), { target: { value: "Keep my draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
  expect((await screen.findByRole("alert")).textContent).toContain("taken");
  expect((screen.getByLabelText("Bio") as HTMLTextAreaElement).value).toBe("Keep my draft");
  expect(changed).not.toHaveBeenCalled();
});

it("saves privacy independently", async () => {
  const fetchMock = mockApi(); render(<Profile {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: "Edit profile" }));
  fireEvent.change(screen.getByLabelText("Profile privacy"), { target: { value: "public" } });
  fireEvent.click(screen.getByRole("button", { name: "Save privacy" }));
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  const patch = fetchMock.mock.calls.find(([, options]) => options?.method === "PATCH");
  expect(patch![0]).toContain("/api/me/profile/visibility");
  expect(JSON.parse(patch![1]!.body as string)).toEqual({ visibility: "public" });
});

it("shows a private profile identity without requesting protected posts or displaying hidden details", async () => {
  const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("/posts")
    ? { message: "This profile is private." }
    : { ...profile, id: "other", display_name: "Maya", handle: "maya.watches", bio: "Hidden bio", can_view_posts: false }), { status: url.endsWith("/posts") ? 403 : 200 }));
  vi.stubGlobal("fetch", fetchMock);
  render(<Profile {...props} profileId="other" />);
  expect(await screen.findByRole("heading", { name: "Maya", exact: true })).toBeTruthy();
  expect(screen.getByText("@maya.watches")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "This profile is private." })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Request to follow" })).toBeTruthy();
  expect(screen.queryByText("Hidden bio")).toBeNull();
  expect(screen.queryByLabelText("Profile statistics")).toBeNull();
  expect(fetchMock.mock.calls.some(([url]) => url.endsWith("/posts"))).toBe(false);
});

it("shows private profile posts to approved followers", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("/posts") ? { items: [] }
    : { ...profile, id: "other", bio: "Movie nights", viewer_follows: true, can_view_posts: true }))));
  render(<Profile {...props} profileId="other" />);
  expect(await screen.findByText("No posts yet.")).toBeTruthy();
  expect(screen.getByText("Movie nights")).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "This profile is private." })).toBeNull();
});

it("can cancel a pending private follow request", async () => {
  let requested = true;
  const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.method === "DELETE") { requested = false; return new Response(null, { status: 204 }); }
    return new Response(JSON.stringify({ ...profile, id: "other", viewer_requested: requested, can_view_posts: false }));
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<Profile {...props} profileId="other" />);
  fireEvent.click(await screen.findByRole("button", { name: "Cancel request" }));
  expect(await screen.findByRole("button", { name: "Request to follow" })).toBeTruthy();
  expect(fetchMock.mock.calls.some(([url, options]) => url.endsWith("/follow") && options?.method === "DELETE")).toBe(true);
});
