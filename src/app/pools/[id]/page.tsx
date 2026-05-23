"use client";

import { use } from "react";
import { AuthGuard } from "@/components/auth/auth-guard";
import { PoolDetail } from "@/components/pools/pool-detail";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { usePool } from "@/hooks/use-pool";
import { ApiError } from "@/lib/api/client";

export default function PoolDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <AuthGuard>
      <PoolDetailContent id={id} />
    </AuthGuard>
  );
}

function PoolDetailContent({ id }: { id: string }) {
  const { data, isLoading, isError, error, refetch } = usePool(id);

  if (isLoading) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8 space-y-4">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-32 w-full" />
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-64 lg:col-span-2" />
          <Skeleton className="h-64" />
        </div>
      </main>
    );
  }

  if (isError) {
    const is404 = error instanceof ApiError && error.httpStatus === 404;
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <Alert variant="destructive">
          <AlertTitle>
            {is404 ? "Pool not found or unavailable" : "Couldn’t load pool"}
          </AlertTitle>
          {!is404 && (
            <AlertDescription className="flex items-center justify-between gap-4">
              <span>
                {error instanceof Error ? error.message : "Unknown error"}
              </span>
              <Button size="sm" variant="outline" onClick={() => refetch()}>
                Retry
              </Button>
            </AlertDescription>
          )}
        </Alert>
      </main>
    );
  }

  if (!data) return null;

  return <PoolDetail pool={data.data} />;
}
