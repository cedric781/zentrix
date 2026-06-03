"use client";

/**
 * CreateBetContext — wizard state Provider for /bets/new.
 *
 * Layer 2 architecture: whole wizard state in one provider. Single-page UI
 * (Layer 1) and future multi-page wizard (Layer 2) both wrap with this
 * provider — child layout decides single page vs route-split.
 *
 * State preservation: switching template pre-fills `title` only.
 * outcomes/side/stake/expires remain user-edited (deliberate UX — switching
 * sports template doesn't wipe an in-progress stake input).
 */

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import type {
  BetTemplateSerialized,
  CreateBetExternalRef,
} from "@/lib/api/types";

export type CreatedBet = {
  betId: string;
  inviteToken: string;
  expiresAt: Date;
};

export type SettlementMode = "PEER_AGREE" | "AUTO_VERIFY";

/**
 * A template can offer objective auto-resolve only when it declares
 * supportsAutoResolve AND has at least one allowed source. Mirrors the gate in
 * BetForm — kept here so the wizard state is the single source of truth.
 */
function deriveCanAutoVerify(t: BetTemplateSerialized | null): boolean {
  if (!t || t.supportsAutoResolve !== true) return false;
  const sources = t.allowedSources;
  return Array.isArray(sources) && sources.length > 0;
}

type CreateBetState = {
  template: BetTemplateSerialized | null;
  setTemplate: (t: BetTemplateSerialized | null) => void;

  title: string;
  setTitle: (s: string) => void;
  outcomeA: string;
  setOutcomeA: (s: string) => void;
  outcomeB: string;
  setOutcomeB: (s: string) => void;
  side: "A" | "B";
  setSide: (s: "A" | "B") => void;
  stakeUnits: string;
  setStakeUnits: (s: string) => void;
  expiresInHours: number;
  setExpiresInHours: (n: number) => void;

  externalRef: CreateBetExternalRef | null;
  setExternalRef: (ref: CreateBetExternalRef | null) => void;

  settlementMode: SettlementMode;
  setSettlementMode: (mode: SettlementMode) => void;
  /** True when the current template can offer AUTO_VERIFY (objective). */
  canAutoVerify: boolean;

  created: CreatedBet | null;
  setCreated: (c: CreatedBet | null) => void;

  reset: () => void;
};

const CreateBetContext = createContext<CreateBetState | null>(null);

export function CreateBetProvider({ children }: { children: ReactNode }) {
  const [template, setTemplate] = useState<BetTemplateSerialized | null>(null);
  const [title, setTitle] = useState("");
  const [outcomeA, setOutcomeA] = useState("");
  const [outcomeB, setOutcomeB] = useState("");
  const [side, setSide] = useState<"A" | "B">("A");
  const [stakeUnits, setStakeUnits] = useState("");
  const [expiresInHours, setExpiresInHours] = useState(24);
  const [externalRef, setExternalRefState] = useState<CreateBetExternalRef | null>(null);
  const [settlementMode, setSettlementModeState] = useState<SettlementMode>("PEER_AGREE");
  const [created, setCreated] = useState<CreatedBet | null>(null);

  // useCallback so ExternalEventPicker's useEffect dep array stays stable.
  const setExternalRef = useCallback((ref: CreateBetExternalRef | null) => {
    setExternalRefState(ref);
  }, []);

  // Coupled setter: switching to PEER_AGREE (subjective) clears any linked
  // event in the SAME update, so the payload can never become
  // PEER_AGREE + externalRef (the rejected combination).
  const setSettlementMode = useCallback((mode: SettlementMode) => {
    setSettlementModeState(mode);
    if (mode === "PEER_AGREE") {
      setExternalRefState(null);
    }
  }, []);

  const canAutoVerify = deriveCanAutoVerify(template);

  const handleSetTemplate = (t: BetTemplateSerialized | null) => {
    setTemplate(t);
    if (t) {
      // Pre-fill title from template.name; preserve user-edited outcomes/side/stake.
      setTitle(t.name);
    }
    // Re-derive the settlement default from the new template, and ALWAYS clear
    // the linked event: an externalRef is bound to the previous template's
    // allowed sources, so carrying it across a switch is never correct — and on
    // a non-capable template it would recreate the PEER_AGREE + ref case.
    const capable = deriveCanAutoVerify(t);
    setSettlementModeState(capable ? "AUTO_VERIFY" : "PEER_AGREE");
    setExternalRefState(null);
  };

  const reset = () => {
    setTemplate(null);
    setTitle("");
    setOutcomeA("");
    setOutcomeB("");
    setSide("A");
    setStakeUnits("");
    setExpiresInHours(24);
    setExternalRefState(null);
    setSettlementModeState("PEER_AGREE");
  };

  return (
    <CreateBetContext.Provider
      value={{
        template,
        setTemplate: handleSetTemplate,
        title,
        setTitle,
        outcomeA,
        setOutcomeA,
        outcomeB,
        setOutcomeB,
        side,
        setSide,
        stakeUnits,
        setStakeUnits,
        expiresInHours,
        setExpiresInHours,
        externalRef,
        setExternalRef,
        settlementMode,
        setSettlementMode,
        canAutoVerify,
        created,
        setCreated,
        reset,
      }}
    >
      {children}
    </CreateBetContext.Provider>
  );
}

export function useCreateBetState() {
  const ctx = useContext(CreateBetContext);
  if (!ctx) {
    throw new Error("useCreateBetState must be used inside <CreateBetProvider>");
  }
  return ctx;
}

// Non-throwing variant for components used both inside and outside the wizard
// (e.g. TemplateCard on the /templates browse page, which navigates instead
// of mutating context).
export function useCreateBetStateOptional() {
  return useContext(CreateBetContext);
}
