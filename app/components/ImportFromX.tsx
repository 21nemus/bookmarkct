"use client";

import { useMemo, useState } from "react";

type TweetApiOk = {
  ok: true;
  url: string;
  id: string;
  text: string;
  authorId?: string;
  createdAt?: string;
};

type TweetApiErr = {
  ok: false;
  error: string;
  details?: unknown;
};

type Props = {
  onImported: (payload: { text: string; url: string }) => void;
};

export function ImportFromX({ onImported }: Props) {
  const [tweetUrl, setTweetUrl] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const canImport = useMemo(() => tweetUrl.trim().length > 0, [tweetUrl]);

  async function handleImport() {
    const trimmed = tweetUrl.trim();
    if (!trimmed) return;

    setIsImporting(true);
    setImportError(null);

    try {
      const res = await fetch(`/api/tweet?url=${encodeURIComponent(trimmed)}`, {
        cache: "no-store",
      });

      const payload = (await res.json()) as TweetApiOk | TweetApiErr;

      if (!res.ok || !payload.ok) {
        const message = (payload as TweetApiErr).error || `Import failed (HTTP ${res.status}).`;
        throw new Error(message);
      }

      const ok = payload as TweetApiOk;
      const text = ok.text?.trim() ?? "";
      if (!text) throw new Error("Tweet text was empty.");

      onImported({ text, url: ok.url });
    } catch (e: any) {
      setImportError(e?.message || "Import failed.");
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <section className="rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
      <div className="mb-4">
        <div className="text-sm font-semibold text-black/80">Import from X</div>
        <div className="text-sm text-black/60">
          Paste a status URL and we&apos;ll fetch the post text via the official X API.
        </div>
      </div>

      <div className="flex gap-3">
        <input
          value={tweetUrl}
          onChange={(e) => setTweetUrl(e.target.value)}
          placeholder="https://x.com/user/status/123..."
          className="h-11 w-full rounded-xl border border-black/15 bg-white px-4 text-sm outline-none focus:border-black/30"
        />

        <button
          onClick={handleImport}
          disabled={!canImport || isImporting}
          className="h-11 shrink-0 rounded-xl bg-black px-5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {isImporting ? "Importing..." : "Import"}
        </button>
      </div>

      {importError ? (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {importError}
        </div>
      ) : null}
    </section>
  );
}