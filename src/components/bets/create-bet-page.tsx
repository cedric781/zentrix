"use client";

import { CreateBetProvider } from "./create-bet-context";
import { TemplateGrid } from "@/components/templates/template-grid";
import { BetForm } from "./bet-form";
import { BetReview } from "./bet-review";
import { SubmitBetButton } from "./submit-bet-button";

export function CreateBetPage() {
  return (
    <CreateBetProvider>
      <div className="container mx-auto py-8 space-y-8 max-w-4xl">
        <header>
          <h1 className="text-3xl font-bold">Create a Bet</h1>
          <p className="text-muted-foreground">
            Pick a template, fill in the details, and challenge an opponent.
          </p>
        </header>

        <section aria-labelledby="template-heading">
          <h2 id="template-heading" className="text-xl font-semibold mb-4">
            1. Pick a template
          </h2>
          <TemplateGrid />
        </section>

        <section aria-labelledby="form-heading">
          <h2 id="form-heading" className="text-xl font-semibold mb-4">
            2. Bet details
          </h2>
          <BetForm />
        </section>

        <section aria-labelledby="review-heading">
          <h2 id="review-heading" className="text-xl font-semibold mb-4">
            3. Review
          </h2>
          <BetReview />
        </section>

        <section>
          <SubmitBetButton />
        </section>
      </div>
    </CreateBetProvider>
  );
}
