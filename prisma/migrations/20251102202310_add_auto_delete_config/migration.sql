-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_XmlProvider" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "xmlUrl" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "syncFrequency" INTEGER NOT NULL DEFAULT 8,
    "autoDelete" BOOLEAN NOT NULL DEFAULT true,
    "lastSync" DATETIME,
    "nextSync" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_XmlProvider" ("createdAt", "id", "isActive", "lastSync", "name", "nextSync", "shop", "syncFrequency", "updatedAt", "xmlUrl") SELECT "createdAt", "id", "isActive", "lastSync", "name", "nextSync", "shop", "syncFrequency", "updatedAt", "xmlUrl" FROM "XmlProvider";
DROP TABLE "XmlProvider";
ALTER TABLE "new_XmlProvider" RENAME TO "XmlProvider";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
