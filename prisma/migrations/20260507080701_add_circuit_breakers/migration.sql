-- CreateTable
CREATE TABLE "circuit_breakers" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "is_open" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "opened_at" TIMESTAMP(3),
    "opened_by" TEXT,
    "closed_at" TIMESTAMP(3),
    "trip_count" INTEGER NOT NULL DEFAULT 0,
    "last_trip_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "circuit_breakers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "circuit_breakers_key_key" ON "circuit_breakers"("key");
