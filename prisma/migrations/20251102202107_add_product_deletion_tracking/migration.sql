-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ProductMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "xmlProductId" TEXT NOT NULL,
    "xmlSku" TEXT,
    "shopifyProductId" TEXT NOT NULL,
    "shopifyHandle" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "lastPrice" REAL,
    "lastUpdated" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenInXml" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductMapping_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "XmlProvider" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ProductMapping" ("createdAt", "id", "lastPrice", "lastUpdated", "providerId", "shopifyHandle", "shopifyProductId", "title", "xmlProductId", "xmlSku") SELECT "createdAt", "id", "lastPrice", "lastUpdated", "providerId", "shopifyHandle", "shopifyProductId", "title", "xmlProductId", "xmlSku" FROM "ProductMapping";
DROP TABLE "ProductMapping";
ALTER TABLE "new_ProductMapping" RENAME TO "ProductMapping";
CREATE UNIQUE INDEX "ProductMapping_providerId_xmlProductId_key" ON "ProductMapping"("providerId", "xmlProductId");
CREATE TABLE "new_SyncLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "totalProducts" INTEGER NOT NULL DEFAULT 0,
    "productsCreated" INTEGER NOT NULL DEFAULT 0,
    "productsUpdated" INTEGER NOT NULL DEFAULT 0,
    "productsDeleted" INTEGER NOT NULL DEFAULT 0,
    "productsErrors" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "details" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "duration" INTEGER,
    CONSTRAINT "SyncLog_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "XmlProvider" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SyncLog" ("completedAt", "details", "duration", "errorMessage", "id", "productsCreated", "productsErrors", "productsUpdated", "providerId", "startedAt", "status", "totalProducts") SELECT "completedAt", "details", "duration", "errorMessage", "id", "productsCreated", "productsErrors", "productsUpdated", "providerId", "startedAt", "status", "totalProducts" FROM "SyncLog";
DROP TABLE "SyncLog";
ALTER TABLE "new_SyncLog" RENAME TO "SyncLog";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
