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

  // useCallback so ExternalEventPicker's useEffect dep array stays stable.
  const setExternalRef = useCallback((ref: CreateBetExternalRef | null) => {
    setExternalRefState(ref);
  }, []);

  const handleSetTemplate = (t: BetTemplateSerialized | null) => {
    setTemplate(t);
    if (t) {
      // Pre-fill title from template.name; preserve user-edited outcomes/side/stake.
      setTitle(t.name);
    }
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
