import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { summarizeText } from "@/lib/summarize";

const MAX_SOURCE_TEXT_LENGTH = 10_000;

// ---- simple in-memory limits (good for demo) ----
type Bucket = {
  minuteKey: string;
  minuteCount: number;
  dayKey: string;
  dayCount: number;
  dayChars: number;
};

const buckets = new Map<string, Bucket>();

function envInt(name: string, fallback: number) {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

const RPM = envInt("BOOKMARKS_RPM", 10);
const DAILY = envInt("BOOKMARKS_DAILY", 200);
const DAILY_CHARS = envInt("BOOKMARKS_DAILY_CHARS", 200_000);

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function getClientIp(request: Request): string {
  // Works in many setups; on Vercel/Proxies you often get x-forwarded-for.
  const xff = request.headers.get("x-forwarded-for");
  if (xff && xff.trim().length > 0) return xff.split(",")[0].trim();
  const realIp = request.headers.get("x-real-ip");
  if (realIp && realIp.trim().length > 0) return realIp.trim();
  return "local";
}

function nowKeys(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  return {
    dayKey: `${y}-${m}-${d}`,
    minuteKey: `${y}-${m}-${d}:${hh}:${mm}`,
  };
}

function enforceLimits(request: Request, sourceTextLength: number) {
  const ip = getClientIp(request);
  const { dayKey, minuteKey } = nowKeys();

  const existing = buckets.get(ip);
  if (!existing) {
    buckets.set(ip, {
      dayKey,
      minuteKey,
      minuteCount: 1,
      dayCount: 1,
      dayChars: sourceTextLength,
    });
    return null;
  }

  // reset minute bucket when minute changes
  if (existing.minuteKey !== minuteKey) {
    existing.minuteKey = minuteKey;
    existing.minuteCount = 0;
  }

  // reset day bucket when day changes
  if (existing.dayKey !== dayKey) {
    existing.dayKey = dayKey;
    existing.dayCount = 0;
    existing.dayChars = 0;
  }

  if (existing.minuteCount + 1 > RPM) {
    return `Rate limit: too many requests. Max ${RPM} per minute.`;
  }
  if (existing.dayCount + 1 > DAILY) {
    return `Daily limit reached. Max ${DAILY} per day.`;
  }
  if (existing.dayChars + sourceTextLength > DAILY_CHARS) {
    return `Daily character limit reached. Max ${DAILY_CHARS} chars per day.`;
  }

  existing.minuteCount += 1;
  existing.dayCount += 1;
  existing.dayChars += sourceTextLength;

  buckets.set(ip, existing);
  return null;
}

export async function GET() {
  try {
    const bookmarks = await prisma.bookmark.findMany({
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(bookmarks);
  } catch (error) {
    console.error("Failed to fetch bookmarks", error);
    return jsonError("Failed to fetch bookmarks.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      sourceText?: unknown;
      sourceUrl?: unknown;
      tweetId?: unknown;
      tweetAuthorId?: unknown;
      tweetCreatedAt?: unknown;
    };

    if (!isNonEmptyString(body.sourceText)) {
      return jsonError("sourceText is required.", 400);
    }

    const sourceText = body.sourceText.trim();

    if (sourceText.length > MAX_SOURCE_TEXT_LENGTH) {
      return jsonError("sourceText exceeds maximum length.", 400);
    }

    const limitErr = enforceLimits(request, sourceText.length);
    if (limitErr) return jsonError(limitErr, 429);

    const sourceUrl =
      typeof body.sourceUrl === "string" && body.sourceUrl.trim().length > 0
        ? body.sourceUrl.trim()
        : null;

    const tweetId =
      typeof body.tweetId === "string" && body.tweetId.trim().length > 0
        ? body.tweetId.trim()
        : null;

    const tweetAuthorId =
      typeof body.tweetAuthorId === "string" && body.tweetAuthorId.trim().length > 0
        ? body.tweetAuthorId.trim()
        : null;

    const tweetCreatedAt =
      typeof body.tweetCreatedAt === "string" && body.tweetCreatedAt.trim().length > 0
        ? body.tweetCreatedAt.trim()
        : null;

    const summary = await summarizeText(sourceText);

    const bookmark = await prisma.bookmark.create({
      data: {
        sourceText,
        summary,
        sourceUrl,
        tweetId,
        tweetAuthorId,
        tweetCreatedAt: tweetCreatedAt ? new Date(tweetCreatedAt) : null,
      },
    });

    return NextResponse.json(bookmark, { status: 201 });
  } catch (error) {
    console.error("Failed to create bookmark", error);
    return jsonError("Failed to create bookmark.", 500);
  }
}