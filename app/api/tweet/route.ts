import { NextResponse } from "next/server";

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function extractTweetId(input: string): string | null {
  const s = input.trim();

  if (/^\d{5,30}$/.test(s)) return s;

  const m = s.match(/\/status\/(\d{5,30})/);
  if (m?.[1]) return m[1];

  const m2 = s.match(/\/i\/web\/status\/(\d{5,30})/);
  if (m2?.[1]) return m2[1];

  return null;
}

function expandUrls(text: string, entities: any): string {
  if (!entities?.urls || !Array.isArray(entities.urls)) return text;

  let out = text;
  for (const u of entities.urls) {
    const short = typeof u?.url === "string" ? u.url : null;
    const expanded = typeof u?.expanded_url === "string" ? u.expanded_url : null;
    if (short && expanded) out = out.split(short).join(expanded);
  }
  return out;
}

function getFirstHttpUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s)]+/i);
  return m?.[0] ? String(m[0]) : null;
}

function looksLikeMostlyLink(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  const urlCount = (t.match(/https?:\/\/[^\s)]+/gi) ?? []).length;
  if (urlCount === 0) return false;

  const withoutUrls = t.replace(/https?:\/\/[^\s)]+/gi, "").replace(/\s+/g, " ").trim();
  return withoutUrls.length <= 40;
}

async function resolveRedirect(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);

  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "User-Agent": "BookmarkCT/1.0 (+https://localhost)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    return res.url || url;
  } finally {
    clearTimeout(timeout);
  }
}

function stripHtmlToText(html: string): string {
  let out = html;

  out = out.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ");
  out = out.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ");
  out = out.replace(/<!--[\s\S]*?-->/g, " ");

  out = out.replace(/<\/(p|div|br|li|h1|h2|h3|h4|h5|h6)>/gi, "\n");
  out = out.replace(/<[^>]+>/g, " ");

  out = out.replace(/&nbsp;/gi, " ");
  out = out.replace(/&amp;/gi, "&");
  out = out.replace(/&quot;/gi, '"');
  out = out.replace(/&#39;/gi, "'");
  out = out.replace(/&lt;/gi, "<");
  out = out.replace(/&gt;/gi, ">");

  out = out.replace(/[ \t]+\n/g, "\n");
  out = out.replace(/\n{3,}/g, "\n\n");
  out = out.replace(/[ \t]{2,}/g, " ");

  return out.trim();
}

async function tryFetchArticleText(resolvedUrl: string): Promise<string | null> {
  // Wir extrahieren nur von Nicht-X Domains, weil X selbst oft JS-lastig ist
  try {
    const u = new URL(resolvedUrl);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (host.endsWith("x.com") || host.endsWith("twitter.com")) return null;
  } catch {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(resolvedUrl, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "User-Agent": "BookmarkCT/1.0 (+https://localhost)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    const contentType = res.headers.get("content-type") ?? "";
    if (!res.ok) return null;
    if (!contentType.toLowerCase().includes("text/html")) return null;

    const html = await res.text();
    const text = stripHtmlToText(html);

    // Heuristik: nicht zu kurz, nicht nur Navigation
    if (text.length < 600) return null;

    // Hard cap, damit wir nicht versehentlich riesige Seiten summarizen
    const MAX = 30_000;
    return text.length > MAX ? text.slice(0, MAX) : text;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function envInt(name: string, fallback: number) {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

const THREAD_MAX_TWEETS = envInt("X_THREAD_MAX_TWEETS", 40);

async function fetchTweetById(bearer: string, tweetId: string) {
  const apiUrl =
    `https://api.x.com/2/tweets/${tweetId}` +
    `?tweet.fields=created_at,author_id,entities,conversation_id`;

  const res = await fetch(apiUrl, {
    method: "GET",
    headers: { Authorization: `Bearer ${bearer}` },
    cache: "no-store",
  });

  const raw = await res.text();

  if (!res.ok) {
    throw new Error(`X API error (${res.status}). ${raw.slice(0, 300)}`);
  }

  const data = JSON.parse(raw) as any;
  const t = data?.data;

  if (!t?.id || typeof t?.text !== "string") {
    throw new Error("Unexpected X API response shape.");
  }

  return t;
}

async function fetchThreadTweets(bearer: string, conversationId: string, authorId: string) {
  const items: Array<{ id: string; text: string; created_at?: string }> = [];
  let nextToken: string | null = null;

  // Für Threads ist das gängige Muster:
  // conversation_id:<id> from:<authorId>
  // Damit bekommst du die Replies des Authors in derselben Conversation
  const baseUrl = "https://api.x.com/2/tweets/search/recent";

  while (items.length < THREAD_MAX_TWEETS) {
    const limit = Math.min(100, THREAD_MAX_TWEETS - items.length);
    const params = new URLSearchParams({
      query: `conversation_id:${conversationId} from:${authorId}`,
      "tweet.fields": "created_at,entities",
      max_results: String(limit),
    });

    if (nextToken) params.set("next_token", nextToken);

    const res = await fetch(`${baseUrl}?${params.toString()}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${bearer}` },
      cache: "no-store",
    });

    const raw = await res.text();

    if (!res.ok) {
      throw new Error(`X Search API error (${res.status}). ${raw.slice(0, 300)}`);
    }

    const json = JSON.parse(raw) as any;
    const data = Array.isArray(json?.data) ? json.data : [];
    for (const t of data) {
      if (!t?.id || typeof t?.text !== "string") continue;
      const expandedText = expandUrls(t.text, t.entities);
      items.push({
        id: String(t.id),
        text: expandedText,
        created_at: t.created_at ? String(t.created_at) : undefined,
      });
    }

    nextToken = typeof json?.meta?.next_token === "string" ? json.meta.next_token : null;
    if (!nextToken) break;
  }

  // Chronologisch sortieren
  items.sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    return ta - tb;
  });

  // Dedupe nach id
  const seen = new Set<string>();
  const unique = items.filter((x) => {
    if (seen.has(x.id)) return false;
    seen.add(x.id);
    return true;
  });

  return unique;
}

export async function GET(request: Request) {
  try {
    const bearer = process.env.X_BEARER_TOKEN;
    if (!bearer) return jsonError("Missing X_BEARER_TOKEN in env.", 500);

    const { searchParams } = new URL(request.url);
    const url = searchParams.get("url") ?? "";
    if (!url.trim()) return jsonError("Missing ?url= parameter.", 400);

    const includeThread = searchParams.get("includeThread") === "1";

    const tweetId = extractTweetId(url);
    if (!tweetId) return jsonError("Could not parse tweet id from URL.", 422);

    const t = await fetchTweetById(bearer, tweetId);
    const expandedText = expandUrls(t.text, t.entities);

    // 1) Link Resolve + optional Article Extraction
    let resolvedUrl: string | null = null;
    let articleText: string | null = null;

    if (looksLikeMostlyLink(expandedText)) {
      const first = getFirstHttpUrl(expandedText);
      if (first) {
        resolvedUrl = await resolveRedirect(first);
        articleText = await tryFetchArticleText(resolvedUrl);
      }
    }

    // 2) Thread Mode (optional)
    let finalText = expandedText;
    let threadCount = 0;

    if (includeThread && t.conversation_id && t.author_id) {
      const conversationId = String(t.conversation_id);
      const authorId = String(t.author_id);

      const threadTweets = await fetchThreadTweets(bearer, conversationId, authorId);

      if (threadTweets.length > 0) {
        threadCount = threadTweets.length;
        finalText = threadTweets
          .map((tw, idx) => {
            const num = String(idx + 1).padStart(2, "0");
            return `(${num}/${threadTweets.length}) ${tw.text}`;
          })
          .join("\n\n");
      }
    }

    // Wenn wir Artikeltext extrahiert haben, geben wir den statt Link-Only Text zurück
    // Aber nur wenn es sinnvoll ist (nicht leer)
    if (articleText && articleText.length > 0) {
      finalText = articleText;
    }

    const textKind = articleText
      ? "article"
      : includeThread && threadCount > 0
        ? "thread"
        : looksLikeMostlyLink(expandedText)
          ? "link"
          : "tweet";

    return NextResponse.json({
      ok: true,
      url: `https://x.com/i/web/status/${t.id}`,
      id: String(t.id),
      text: finalText,
      textKind,
      resolvedUrl,
      threadCount: threadCount > 0 ? threadCount : null,
      authorId: t.author_id ? String(t.author_id) : null,
      createdAt: t.created_at ? String(t.created_at) : null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return jsonError(`Tweet import failed: ${msg}`, 500);
  }
}