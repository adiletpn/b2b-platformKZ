-- CreateTable
CREATE TABLE "delivery_routes" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "driverMembershipId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_route_stops" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "delivery_route_stops_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delivery_routes_supplierId_date_idx" ON "delivery_routes"("supplierId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_routes_supplierId_number_key" ON "delivery_routes"("supplierId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_route_stops_orderId_key" ON "delivery_route_stops"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_route_stops_routeId_position_key" ON "delivery_route_stops"("routeId", "position");

-- AddForeignKey
ALTER TABLE "delivery_routes" ADD CONSTRAINT "delivery_routes_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_routes" ADD CONSTRAINT "delivery_routes_driverMembershipId_fkey" FOREIGN KEY ("driverMembershipId") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_route_stops" ADD CONSTRAINT "delivery_route_stops_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "delivery_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_route_stops" ADD CONSTRAINT "delivery_route_stops_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

