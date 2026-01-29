-- CreateTable
CREATE TABLE "Bookmark" (
    "id" TEXT NOT NULL,
    "sourceText" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tweetId" TEXT,
    "tweetAuthorId" TEXT,
    "tweetCreatedAt" TIMESTAMP(3),

    CONSTRAINT "Bookmark_pkey" PRIMARY KEY ("id")
);
