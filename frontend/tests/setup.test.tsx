// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import Setup from "../src/components/Setup";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("account setup", () => {
  it("requires a username and privacy, then saves optional choices with capitalization", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ setup_complete: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const complete = vi.fn();
    render(<Setup token="token" onComplete={complete} onSignOut={() => {}} />);
    const username = screen.getByLabelText("Username (required)") as HTMLInputElement;
    const form = username.closest("form")!;
    expect(form.checkValidity()).toBe(false);
    fireEvent.change(username, { target: { value: "Jack" } });
    expect(form.checkValidity()).toBe(false);
    fireEvent.click(screen.getByRole("radio", { name: /^Private/ }));
    fireEvent.click(screen.getByLabelText(/Comedy/));
    expect(form.checkValidity()).toBe(true);
    fireEvent.submit(form);
    await waitFor(() => expect(complete).toHaveBeenCalledOnce());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ username: "Jack", visibility: "private", favorite_genres: ["Comedy"], streaming_services: [] });
  });

  it("displays a taken username and leaves setup open", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "That username is already taken." }), { status: 409 })));
    const complete = vi.fn();
    render(<Setup token="token" onComplete={complete} onSignOut={() => {}} />);
    fireEvent.change(screen.getByLabelText("Username (required)"), { target: { value: "jack" } });
    fireEvent.click(screen.getByRole("radio", { name: /^Public/ }));
    fireEvent.submit(screen.getByLabelText("Username (required)").closest("form")!);
    expect((await screen.findByRole("alert")).textContent).toContain("already taken");
    expect(complete).not.toHaveBeenCalled();
  });
});
