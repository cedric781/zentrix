"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { CreateBetProvider, useCreateBetState } from "./create-bet-context";
import { TemplateGrid } from "@/components/templates/template-grid";
import { useTemplates } from "@/hooks/use-templates";
import { BetForm } from "./bet-form";
import { BetReview } from "./bet-review";
import { SubmitBetButton } from "./submit-bet-button";
import { BetCreatedShare } from "./bet-created-share";
import { Button } from "@/components/ui/button";

export function CreateBetPage() {
  return (
    <CreateBetProvider>
      <TemplatePreselect />
      <div className="container mx-auto py-8 space-y-8 max-w-4xl">
        <header>
          <h1 className="text-3xl font-bold">Create a Bet</h1>
          <p className="text-muted-foreground">
            Start from a template or make your own, fill in the details, and
            challenge an opponent.
          </p>
        </header>
        <CreateBetBody />
      </div>
    </CreateBetProvider>
  );
}

function ModeToggle() {
  const { isCustom, setIsCustom } = useCreateBetState();
  return (
    <div
      className="flex gap-2"
      role="group"
      aria-label="Bet creation mode"
    >
      <Button
        type="button"
        variant={!isCustom ? "default" : "outline"}
        onClick={() => setIsCustom(false)}
        className="flex-1"
      >
        From a template
      </Button>
      <Button
        type="button"
        variant={isCustom ? "default" : "outline"}
        onClick={() => setIsCustom(true)}
        className="flex-1"
      >
        Make your own
      </Button>
    </div>
  );
}

function CreateBetBody() {
  const { created, isCustom } = useCreateBetState();

  if (created) {
    return (
      <BetCreatedShare
        betId={created.betId}
        inviteToken={created.inviteToken}
        expiresAt={created.expiresAt}
      />
    );
  }

  // Step numbers shift when the template step is hidden in custom mode.
  const detailsStep = isCustom ? 1 : 2;
  const reviewStep = isCustom ? 2 : 3;

  return (
    <>
      <ModeToggle />

      {!isCustom && (
        <section aria-labelledby="template-heading">
          <h2 id="template-heading" className="text-xl font-semibold mb-4">
            1. Pick a template
          </h2>
          <TemplateGrid />
        </section>
      )}

      <section aria-labelledby="form-heading">
        <h2 id="form-heading" className="text-xl font-semibold mb-4">
          {detailsStep}. Bet details
        </h2>
        <BetForm />
      </section>

      <section aria-labelledby="review-heading">
        <h2 id="review-heading" className="text-xl font-semibold mb-4">
          {reviewStep}. Review
        </h2>
        <BetReview />
      </section>

      <section>
        <SubmitBetButton />
      </section>
    </>
  );
}

function TemplatePreselect() {
  const searchParams = useSearchParams();
  const templateSlug = searchParams.get("template");
  const mode = searchParams.get("mode");
  const { template, isCustom, setTemplate, setIsCustom } = useCreateBetState();
  const { data } = useTemplates();

  // ?template=<slug> preselects a template (existing behaviour).
  useEffect(() => {
    if (!templateSlug || template || !data?.templates) return;
    const found = data.templates.find((t) => t.slug === templateSlug);
    if (found) setTemplate(found);
  }, [templateSlug, template, data, setTemplate]);

  // ?mode=custom enters custom (free-bet) mode on mount — mirrors ?template=.
  // An explicit template param wins, since the two are mutually exclusive.
  useEffect(() => {
    if (mode !== "custom" || templateSlug || isCustom || template) return;
    setIsCustom(true);
  }, [mode, templateSlug, isCustom, template, setIsCustom]);

  return null;
}
