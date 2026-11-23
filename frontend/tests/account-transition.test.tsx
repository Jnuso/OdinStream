// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Session } from "@supabase/supabase-js";
import { afterEach, expect, it, vi } from "vitest";
import App from "../src/App";

const mocks = vi.hoisted(() => ({
  authChanged: null as ((event: string, session: Session | null) => void) | null,
  api: vi.fn(),
}));

vi.mock("../src/data/auth", () => ({
  authCallbackError: null,
  supabase: { auth: {
    onAuthStateChange: vi.fn((callback) => {
      mocks.authChanged = callback;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
    signOut: vi.fn(),
  } },
}));
vi.mock("../src/data/api", () => ({ api: mocks.api }));

const session = { user: { id: "test-user" }, access_token: "test-token" } as Session;

afterEach(() => { cleanup(); mocks.api.mockReset(); mocks.authChanged = null; });

it("shows a branded status while the verification session and setup status load", async () => {
  let resolveSetup!: (value: { setup_complete: boolean }) => void;
  mocks.api.mockReturnValue(new Promise(resolve => { resolveSetup = resolve; }));
  render(<App />);
  expect(screen.getByRole("status").textContent).toContain("Getting your account ready");
  expect(screen.getByText("Odin", { exact: false })).toBeTruthy();
  act(() => mocks.authChanged!("SIGNED_IN", session));
  expect(screen.getByRole("status").textContent).toContain("Getting your account ready");
  await act(async () => resolveSetup({ setup_complete: false }));
  expect(screen.getByRole("heading", { name: "Set up your profile" })).toBeTruthy();
  expect(screen.queryByText("Checking account setup…")).toBeNull();
});

it("lets a failed setup check retry and resume onboarding", async () => {
  mocks.api.mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValueOnce({ setup_complete: false });
  render(<App />);
  act(() => mocks.authChanged!("SIGNED_IN", session));
  await screen.findByRole("alert");
  expect(screen.getByRole("heading", { name: "We couldn’t open your account" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByRole("heading", { name: "Set up your profile" });
  expect(mocks.api).toHaveBeenCalledTimes(2);
});

it("keeps the setup step on token refresh and opens Discover after completion", async () => {
  window.location.hash = "#/account";
  mocks.api.mockImplementation(async (path, _token, options) => {
    if (path === "/api/me/setup") return { setup_complete: options?.method === "PUT" };
    if (path === "/api/me/profile") return { id: "test-user", display_name: "Jack", handle: "Jack" };
    return { items: [], favorite_genres: [], streaming_services: [] };
  });
  render(<App />);
  act(() => mocks.authChanged!("SIGNED_IN", session));
  const username = await screen.findByLabelText("Username (required)");
  fireEvent.change(username, { target: { value: "Jack" } });
  fireEvent.click(screen.getByRole("radio", { name: /^Private/ }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await act(async () => mocks.authChanged!("TOKEN_REFRESHED", { ...session, access_token: "refreshed-token" }));
  expect(screen.getByRole("heading", { name: "Your streaming services" })).toBeTruthy();
  for (let step = 2; step <= 5; step++) {
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
  }
  await screen.findByRole("heading", { name: "Discover" });
  expect(window.location.hash).toMatch(/^#\/discover(?:\?|$)/);
});
