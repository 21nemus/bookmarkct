import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { summarizeText } from "@/lib/summarize";

const MAX_SOURCE_TEXT_LENGTH = 10_000;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
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
    };

    if (!isNonEmptyString(body.sourceText)) {
      return jsonError("sourceText is required.", 400);
    }

    if (body.sourceText.length > MAX_SOURCE_TEXT_LENGTH) {
      return jsonError("sourceText exceeds maximum length.", 400);
    }

    const sourceUrl =
      typeof body.sourceUrl === "string" && body.sourceUrl.trim().length > 0
        ? body.sourceUrl.trim()
        : null;

    const summary = await summarizeText(body.sourceText);

    const bookmark = await prisma.bookmark.create({
      data: {
        sourceText: body.sourceText,
        sourceUrl,
        summary,
      },
    });

    return NextResponse.json(bookmark, { status: 201 });
  } catch (error) {
    console.error("Failed to create bookmark", error);
    return jsonError("Failed to create bookmark.", 500);
  }
}
