// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

// ── Hoisted mocks (vi.mock factories are hoisted, so refs must be too) ─

const {
  mockPush,
  mockCurrentUser,
  mockWalletDelegation,
  mockAcceptBet,
  mockToast,
} = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockCurrentUser: vi.fn(),
  mockWalletDelegation: vi.fn(),
  mockAcceptBet: vi.fn(),
  mockToast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/hooks/use-current-user", () => ({
  useCurrentUser: () => mockCurrentUser(),
}));

vi.mock("@/hooks/use-wallet-delegation", () => ({
  useWalletDelegation: () => mockWalletDelegation(),
}));

vi.mock("@/lib/api/bets", () => ({
  acceptBet: (...args: unknown[]) => mockAcceptBet(...args),
}));

vi.mock("sonner", () => ({
  toast: mockToast,
}));

import { AcceptInviteButton } from "@/components/bets/accept-invite-button";
import { ApiError } from "@/lib/api/client";

// ── Helpers ────────────────────────────────────────────────────────────

function setDefaults(overrides?: {
  user?: { id: string } | null;
  isLoading?: boolean;
  delegationStatus?: string;
}) {
  mockCurrentUser.mockReturnValue({
    data: overrides?.user === null ? undefined : (overrides?.user ?? { id: "u-1" }),
    isLoading: overrides?.isLoading ?? false,
  });
  mockWalletDelegation.mockReturnValue({
    status: overrides?.delegationStatus ?? "AUTHORIZED",
    delegate: vi.fn().mockResolvedValue({ ok: true }),
    delegating: false,
    error: null,
  });
}

const defaultProps = {
  betId: "bet-1",
  inviteToken: "abcdef1234567890",
  stakeLabel: "1.00 USDC",
};

// ── Tests ──────────────────────────────────────────────────────────────

describe("AcceptInviteButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders accept button when delegation is authorized", () => {
    setDefaults();
    render(<AcceptInviteButton {...defaultProps} />);
    const btn = screen.getByRole("button", {
      name: /Accepteer bet voor 1\.00 USDC/,
    });
    expect(btn).toBeEnabled();
  });

  it("calls acceptBet with inviteToken and idempotencyKey on click", async () => {
    setDefaults();
    mockAcceptBet.mockResolvedValue({ bet: { id: "bet-1" } });
    const user = userEvent.setup();

    render(<AcceptInviteButton {...defaultProps} />);
    await user.click(
      screen.getByRole("button", { name: /Accepteer bet/ }),
    );

    expect(mockAcceptBet).toHaveBeenCalledOnce();
    const [params, options] = mockAcceptBet.mock.calls[0];
    expect(params).toEqual({
      betId: "bet-1",
      inviteToken: "abcdef1234567890",
    });
    expect(options.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("maps BET_WALLET_NOT_DELEGATED to toast with action to /me", async () => {
    setDefaults();
    mockAcceptBet.mockRejectedValue(
      new ApiError(
        "BET_WALLET_NOT_DELEGATED",
        "Wallet authorization required",
        403,
      ),
    );
    const user = userEvent.setup();

    render(<AcceptInviteButton {...defaultProps} />);
    await user.click(
      screen.getByRole("button", { name: /Accepteer bet/ }),
    );

    expect(mockToast.error).toHaveBeenCalledWith(
      "Wallet niet geautoriseerd",
      expect.objectContaining({
        description: expect.stringContaining("wallet"),
        action: expect.objectContaining({
          label: "Wallet instellingen",
        }),
      }),
    );

    const call = mockToast.error.mock.calls[0];
    call[1].action.onClick();
    expect(mockPush).toHaveBeenCalledWith("/me");
  });

  it("maps BET_ALREADY_ACCEPTED to specific Dutch toast (regression guard)", async () => {
    setDefaults();
    mockAcceptBet.mockRejectedValue(
      new ApiError("BET_ALREADY_ACCEPTED", "Already accepted", 409),
    );
    const user = userEvent.setup();

    render(<AcceptInviteButton {...defaultProps} />);
    await user.click(
      screen.getByRole("button", { name: /Accepteer bet/ }),
    );

    expect(mockToast.error).toHaveBeenCalledWith(
      "Deze bet is al geaccepteerd.",
    );
  });

  it("maps unknown error code to fallback toast (regression guard)", async () => {
    setDefaults();
    mockAcceptBet.mockRejectedValue(
      new ApiError("SOME_NEW_CODE", "Something broke", 500),
    );
    const user = userEvent.setup();

    render(<AcceptInviteButton {...defaultProps} />);
    await user.click(
      screen.getByRole("button", { name: /Accepteer bet/ }),
    );

    expect(mockToast.error).toHaveBeenCalledWith("Something broke");
  });

  it("disables button when delegation status is not AUTHORIZED", () => {
    setDefaults({ delegationStatus: "READY_TO_AUTHORIZE" });
    render(<AcceptInviteButton {...defaultProps} />);

    const btn = screen.getByRole("button", {
      name: /Accepteer bet/,
    });
    expect(btn).toBeDisabled();
    expect(screen.getByText(/Autoriseer je wallet/)).toBeInTheDocument();
  });

  it("shows loading state when delegation status is LOADING", () => {
    setDefaults({ delegationStatus: "LOADING" });
    render(<AcceptInviteButton {...defaultProps} />);

    const btn = screen.getByRole("button", { name: /Wallet laden/ });
    expect(btn).toBeDisabled();
  });

  it("shows login button when user is not authenticated", () => {
    setDefaults({ user: null });
    render(<AcceptInviteButton {...defaultProps} />);

    const link = screen.getByRole("link", { name: /Log in/ });
    expect(link).toHaveAttribute(
      "href",
      expect.stringContaining("/signin"),
    );
  });
});
