"use client";

import { useEffect, useMemo, useState } from "react";

type Bookmark = {
  id: string;
  sourceText: string;
  summary: string;
  sourceUrl: string | null;
  createdAt: string;
};

const MAX_SOURCE_TEXT_LENGTH = 10_000;

export default function Home() {
  const [sourceText, setSourceText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remainingChars = useMemo(
    () => MAX_SOURCE_TEXT_LENGTH - sourceText.length,
    [sourceText.length]
  );

  const loadBookmarks = async () => {
    try {
      const response = await fetch("/api/bookmarks", { cache: "no-store" });

      if (!response.ok) {
        throw new Error("Failed to load bookmarks.");
      }

      const data = (await response.json()) as Bookmark[];
      setBookmarks(data);
    } catch (fetchError) {
      console.error(fetchError);
      setError("Unable to load bookmarks. Please try again.");
    }
  };

  useEffect(() => {
    void loadBookmarks();
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const trimmedText = sourceText.trim();

    if (!trimmedText) {
      setError("Source text is required.");
      return;
    }

    if (trimmedText.length > MAX_SOURCE_TEXT_LENGTH) {
      setError("Source text exceeds the maximum length.");
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/bookmarks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceText: trimmedText,
          sourceUrl: sourceUrl.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Failed to create bookmark.");
      }

      setSourceText("");
      setSourceUrl("");
      await loadBookmarks();
    } catch (submitError) {
      console.error(submitError);
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Something went wrong. Please try again."
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 px-4 py-10 text-zinc-900 sm:px-8 lg:px-16">
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-10">
        <header className="space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight">
            Bookmark summarizer
          </h1>
          <p className="text-base text-zinc-600">
            Paste any text, generate a short summary, and save it for later.
          </p>
        </header>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"
        >
          <div className="space-y-4">
            <div>
              <label
                htmlFor="sourceText"
                className="text-sm font-medium text-zinc-700"
              >
                Source text
              </label>
              <textarea
                id="sourceText"
                name="sourceText"
                rows={6}
                value={sourceText}
                onChange={(event) => setSourceText(event.target.value)}
                maxLength={MAX_SOURCE_TEXT_LENGTH}
                className="mt-2 w-full rounded-xl border border-zinc-200 px-4 py-3 text-sm shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200"
                placeholder="Paste text to summarize..."
              />
              <p className="mt-2 text-xs text-zinc-500">
                {remainingChars} characters remaining
              </p>
            </div>

            <div>
              <label
                htmlFor="sourceUrl"
                className="text-sm font-medium text-zinc-700"
              >
                Source URL (optional)
              </label>
              <input
                id="sourceUrl"
                name="sourceUrl"
                type="url"
                value={sourceUrl}
                onChange={(event) => setSourceUrl(event.target.value)}
                className="mt-2 w-full rounded-xl border border-zinc-200 px-4 py-3 text-sm shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200"
                placeholder="https://example.com"
              />
            </div>

            {error ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={isLoading}
              className="inline-flex items-center justify-center rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isLoading ? "Summarizing..." : "Summarize & Save"}
            </button>
          </div>
        </form>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Saved bookmarks</h2>
            <span className="text-sm text-zinc-500">
              {bookmarks.length} total
            </span>
          </div>

          {bookmarks.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">
              No bookmarks yet. Add your first summary above.
            </div>
          ) : (
            <div className="space-y-4">
              {bookmarks.map((bookmark) => (
                <article
                  key={bookmark.id}
                  className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"
                >
                  <p className="text-sm text-zinc-700">{bookmark.summary}</p>
                  <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
                    <span>
                      {new Date(bookmark.createdAt).toLocaleString()}
                    </span>
                    {bookmark.sourceUrl ? (
                      <a
                        href={bookmark.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-zinc-700 underline decoration-zinc-300 underline-offset-4 hover:text-zinc-900"
                      >
                        {bookmark.sourceUrl}
                      </a>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
