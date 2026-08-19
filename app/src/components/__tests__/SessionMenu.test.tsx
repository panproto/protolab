import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionMenu } from "../SessionMenu";
import { Toolbar } from "../../panels/Toolbar";
import { PresentationToolbar } from "../../presentation/PresentationToolbar";
import { useSessionsStore } from "../../sessions/store";
import type { Session } from "../../sessions/types";

function makeSession(over: Partial<Session> = {}): Session {
  return {
    did: "did:plc:alice",
    handle: "alice.bsky.social",
    pdsUrl: "https://pds.example",
    label: "alice.bsky.social",
    expiresAt: null,
    scope: "atproto",
    ...over,
  };
}

function reset(sessions: Record<string, Session> = {}, activeDid: string | null = null) {
  useSessionsStore.setState({ sessions, activeDid }, false);
}

beforeEach(() => reset());

describe("SessionMenu trigger", () => {
  it("shows a labelled Sign in button when signed out", async () => {
    render(<SessionMenu />);
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  // The trigger is the user's avatar once signed in, and nothing else: no
  // handle text, no other-accounts count. Both live in the panel.
  it("collapses to the avatar alone when signed in", async () => {
    const s = makeSession({ avatar: "https://cdn.example/alice.jpg" });
    reset({ [s.did]: s }, s.did);
    render(<SessionMenu />);

    const trigger = await screen.findByRole("button", {
      name: "Account: @alice.bsky.social",
    });
    const img = trigger.querySelector("img");
    expect(img).toBeTruthy();
    expect(img).toHaveAttribute("src", "https://cdn.example/alice.jpg");
    // The handle must not be painted onto the bar next to the avatar.
    expect(trigger).not.toHaveTextContent("alice.bsky.social");
  });

  it("falls back to initials when the profile has no avatar", async () => {
    const s = makeSession();
    reset({ [s.did]: s }, s.did);
    render(<SessionMenu />);
    const trigger = await screen.findByRole("button", {
      name: "Account: @alice.bsky.social",
    });
    expect(trigger.querySelector("img")).toBeNull();
    expect(trigger).toHaveTextContent("AL");
  });

  it("does not show a count badge for extra accounts on the trigger", async () => {
    const a = makeSession();
    const b = makeSession({ did: "did:plc:bob", handle: "bob.bsky.social", label: "bob.bsky.social" });
    reset({ [a.did]: a, [b.did]: b }, a.did);
    render(<SessionMenu />);
    const trigger = await screen.findByRole("button", {
      name: "Account: @alice.bsky.social",
    });
    expect(trigger).not.toHaveTextContent("+1");
    // The second account is still discoverable — via the tooltip, and in
    // the panel itself.
    expect(trigger).toHaveAttribute(
      "title",
      "Publishing as @alice.bsky.social — 2 accounts signed in",
    );
  });

  it("opens a panel listing every signed-in account", async () => {
    const a = makeSession();
    const b = makeSession({ did: "did:plc:bob", handle: "bob.bsky.social", label: "bob.bsky.social" });
    reset({ [a.did]: a, [b.did]: b }, a.did);
    render(<SessionMenu />);

    const trigger = await screen.findByRole("button", {
      name: "Account: @alice.bsky.social",
    });
    await userEvent.click(trigger);

    await waitFor(() => {
      expect(screen.getByText("Accounts")).toBeInTheDocument();
    });
    expect(screen.getByText("alice.bsky.social")).toBeInTheDocument();
    expect(screen.getByText("bob.bsky.social")).toBeInTheDocument();
  });
});

// A bare visit to protolab lands in presentation mode, so an account
// control that exists only in the edit toolbar is unreachable for anyone
// who has not been told about Cmd+E. Both bars carry it.
describe("account control is reachable from either mode", () => {
  it("renders in the edit-mode toolbar", async () => {
    render(<Toolbar />);
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("renders in the presentation-mode toolbar", async () => {
    render(<PresentationToolbar />);
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("offers the lens library from both modes", async () => {
    const { unmount } = render(<Toolbar />);
    expect(screen.getByRole("button", { name: "Library" })).toBeInTheDocument();
    // Let SessionMenu's session probe settle before unmounting, so the
    // status update lands inside act().
    await screen.findByRole("button", { name: "Sign in" });
    unmount();

    render(<PresentationToolbar />);
    expect(screen.getByRole("button", { name: "Library" })).toBeInTheDocument();
    await screen.findByRole("button", { name: "Sign in" });
  });
});
