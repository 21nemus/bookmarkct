"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { keccak256, toBytes } from "viem";
import {
  useAccount,
  useChainId,
  useConnect,
  useDisconnect,
  usePublicClient,
  useSwitchChain,
  useWriteContract,
} from "wagmi";

import onchainConfig from "@/lib/onchain/bookmarkct.testnet.json";

type Bookmark = {
  id: string;
  sourceText: string;
  summary: string;
  sourceUrl: string | null;
  createdAt: string;
  tweetId?: string | null;
  tweetAuthorId?: string | null;
  tweetCreatedAt?: string | null;
};

type TweetApiOk = {
  ok: true;
  url: string;
  id: string;
  text: string;
  authorId: string | null;
  createdAt: string | null;
};

type TweetApiErr = {
  ok: false;
  error: string;
};

type TweetMeta = {
  tweetId: string;
  tweetAuthorId: string | null;
  tweetCreatedAt: string | null;
};

type TxState = {
  status: "idle" | "wallet" | "pending" | "success" | "error";
  hash?: `0x${string}`;
  error?: string;
};

const MAX_SOURCE_TEXT_LENGTH = 10_000;
const MAX_SUMMARY_PREVIEW = 200;

function isMetaMaskInstalled(): boolean {
  if (typeof window === "undefined") return false;
  const anyWindow = window as unknown as { ethereum?: any };
  const eth = anyWindow.ethereum;
  if (!eth) return false;
  if (Array.isArray(eth.providers)) {
    return eth.providers.some((p: any) => p?.isMetaMask);
  }
  return Boolean(eth.isMetaMask);
}

function formatCreatedAt(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toISOString().replace("T", " ").slice(0, 19);
}

function shortHost(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function clampText(text: string, maxChars: number): string {
  const t = (text ?? "").trim();
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars).trimEnd() + "…";
}

function classifySource(bookmark: {
  sourceUrl: string | null;
  sourceText: string;
  tweetId?: string | null;
}): { kind: "tweet" | "thread" | "article" | "text"; label: string } {
  const url = (bookmark.sourceUrl ?? "").toLowerCase();

  if (
    url.includes("/i/articles/") ||
    url.includes("/i/article/") ||
    url.includes("x.com/i/articles") ||
    url.includes("x.com/i/article")
  ) {
    return { kind: "article", label: "Article" };
  }

  if (url.includes("x.com/") && url.includes("/status/")) {
    const text = bookmark.sourceText || "";
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    const hasManyLines = lines.length >= 5;
    const hasThreadMarkers =
      /\bthread\b/i.test(text) ||
      /\b1\/(\d{1,2})\b/.test(text) ||
      /\b2\/(\d{1,2})\b/.test(text) ||
      text.includes("\n\n") ||
      text.includes("\n• ") ||
      text.includes("\n- ");

    if (hasManyLines && hasThreadMarkers) {
      return { kind: "thread", label: "Thread" };
    }
    return { kind: "tweet", label: "Tweet" };
  }

  if (!bookmark.sourceUrl) return { kind: "text", label: "Text" };
  return { kind: "article", label: "Link" };
}

function truncateAddress(addr?: string): string {
  if (!addr) return "";
  if (addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
function navPill(active: boolean) {
  return cx(
    "rounded-full px-3 py-1.5 text-xs transition",
    active
      ? "bg-white text-zinc-900"
      : "bg-white/5 soft-border text-zinc-200 hover:bg-white/10"
  );
}

export default function Home() {
  const heroRef = useRef<HTMLElement | null>(null);
  const actionRef = useRef<HTMLElement | null>(null);
  const vaultRef = useRef<HTMLElement | null>(null);
  const [activeSection, setActiveSection] = useState<"hero" | "summarize" | "vault">("hero");
  const [mode, setMode] = useState<"x" | "text">("x");
  const [sourceText, setSourceText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [tweetUrl, setTweetUrl] = useState("");
  const [tweetMeta, setTweetMeta] = useState<TweetMeta | null>(null);

  const [importError, setImportError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txStates, setTxStates] = useState<Record<string, TxState>>({});

  const [expandedById, setExpandedById] = useState<Record<string, boolean>>({});
  const toggleExpanded = (id: string) =>
    setExpandedById((prev) => ({ ...prev, [id]: !prev[id] }));

  const [activeFilter, setActiveFilter] = useState<
    "all" | "tweet" | "thread" | "article" | "text"
  >("all");
  const [query, setQuery] = useState("");

  const remainingChars = useMemo(
    () => MAX_SOURCE_TEXT_LENGTH - sourceText.length,
    [sourceText.length]
  );

  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connect, connectors, isPending: isConnecting, error: connectError } =
    useConnect();
  const { disconnect } = useDisconnect();
  const publicClient = usePublicClient({ chainId: onchainConfig.chainId });
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync, isPending: isSwitchingChain } = useSwitchChain();

  const [walletError, setWalletError] = useState<string | null>(null);

  const contractAddress =
    typeof onchainConfig.address === "string" ? onchainConfig.address : "";
  const isContractConfigured = Boolean(contractAddress);

  const expectedChainId = onchainConfig.chainId;
  const isOnExpectedChain = chainId === expectedChainId;

  const scrollTo = (ref: React.RefObject<HTMLElement | null>) => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const loadBookmarks = async () => {
    try {
      const response = await fetch("/api/bookmarks", { cache: "no-store" });
      if (!response.ok) throw new Error("Failed to load bookmarks.");
      const data = (await response.json()) as Bookmark[];
      setBookmarks(data);
    } catch {
      setError("Unable to load bookmarks.");
    }
  };

  useEffect(() => {
    void loadBookmarks();
  }, []);
  useEffect(() => {
    const hero = heroRef.current;
    const action = actionRef.current;
    const vault = vaultRef.current;
  
    if (!hero || !action || !vault) return;
  
    const entriesToSection = (target: Element): "hero" | "summarize" | "vault" => {
      if (target === hero) return "hero";
      if (target === action) return "summarize";
      return "vault";
    };
  
    const obs = new IntersectionObserver(
      (entries) => {
        // Nimm das Element mit der höchsten Sichtbarkeit
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => (b.intersectionRatio ?? 0) - (a.intersectionRatio ?? 0))[0];
  
        if (!visible?.target) return;
        setActiveSection(entriesToSection(visible.target));
      },
      {
        root: null,
        // Header ist sticky, daher top margin
        rootMargin: "-120px 0px -65% 0px",
        threshold: [0.05, 0.15, 0.3, 0.5, 0.8],
      }
    );
  
    obs.observe(hero);
    obs.observe(action);
    obs.observe(vault);
  
    return () => obs.disconnect();
  }, []);
  const handleImportFromX = async () => {
    setImportError(null);
    setError(null);

    if (!tweetUrl.trim()) {
      setImportError("Paste an X status URL first.");
      return;
    }

    setIsImporting(true);
    try {
      const res = await fetch(`/api/tweet?url=${encodeURIComponent(tweetUrl)}`);
      const payload = (await res.json()) as TweetApiOk | TweetApiErr;

      if (!res.ok || !payload.ok) {
        throw new Error(
          "ok" in payload ? "Import failed." : payload.error ?? "Import failed."
        );
      }

      setSourceText(payload.text);
      setSourceUrl(payload.url);
      setTweetMeta({
        tweetId: payload.id,
        tweetAuthorId: payload.authorId,
        tweetCreatedAt: payload.createdAt,
      });
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Import failed.");
      setTweetMeta(null);
    } finally {
      setIsImporting(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const text = sourceText.trim();
    if (!text) {
      setError("Source text is required.");
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch("/api/bookmarks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceText: text,
          sourceUrl: sourceUrl || undefined,
          tweetId: tweetMeta?.tweetId,
          tweetAuthorId: tweetMeta?.tweetAuthorId,
          tweetCreatedAt: tweetMeta?.tweetCreatedAt,
        }),
      });

      if (!res.ok) {
        const payload = (await res.json()) as { error?: string };
        throw new Error(payload.error ?? "Failed to create bookmark.");
      }

      setSourceText("");
      setSourceUrl("");
      setTweetUrl("");
      setTweetMeta(null);
      await loadBookmarks();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveOnchain = async (bookmark: Bookmark) => {
    if (!isConnected) {
      setError("Connect your wallet to save on-chain.");
      return;
    }
    if (!isContractConfigured) {
      setError("Deploy the contract first.");
      return;
    }
    if (!isOnExpectedChain) {
      setError("Switch your wallet to BNB Smart Chain Testnet (chainId 97).");
      return;
    }

    setError(null);
    setTxStates((prev) => ({ ...prev, [bookmark.id]: { status: "wallet" } }));

    try {
      const summaryHash = keccak256(toBytes(bookmark.summary));
      const summaryPreview = bookmark.summary.slice(0, MAX_SUMMARY_PREVIEW);

      const hash = await writeContractAsync({
        address: contractAddress as `0x${string}`,
        abi: onchainConfig.abi,
        functionName: "createBookmark",
        args: [bookmark.sourceUrl ?? "", summaryHash, summaryPreview],
        chainId: onchainConfig.chainId,
      });

      setTxStates((prev) => ({
        ...prev,
        [bookmark.id]: { status: "pending", hash },
      }));

      if (publicClient) {
        await publicClient.waitForTransactionReceipt({ hash });
      }

      setTxStates((prev) => ({
        ...prev,
        [bookmark.id]: { status: "success", hash },
      }));
    } catch (txError) {
      const message =
        txError instanceof Error ? txError.message : "Failed to submit transaction.";
      setTxStates((prev) => ({
        ...prev,
        [bookmark.id]: { status: "error", error: message },
      }));
    }
  };

  const connectWallet = async () => {
    setWalletError(null);
    if (!isMetaMaskInstalled()) {
      setWalletError("MetaMask not detected.");
      return;
    }
    const injected = connectors[0];
    if (!injected) {
      setWalletError("No wallet connector available.");
      return;
    }
    connect({ connector: injected });
  };

  const switchToBscTestnet = async () => {
    setWalletError(null);
    try {
      await switchChainAsync({ chainId: expectedChainId });
    } catch (e) {
      setWalletError(e instanceof Error ? e.message : "Failed to switch network.");
    }
  };

  const copyToClipboard = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      setError("Copy failed.");
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return bookmarks.filter((b) => {
      const meta = classifySource(b);
      if (activeFilter !== "all" && meta.kind !== activeFilter) return false;
      if (!q) return true;

      const hay = [
        b.summary ?? "",
        b.sourceText ?? "",
        b.sourceUrl ?? "",
        b.tweetAuthorId ?? "",
        b.tweetId ?? "",
      ]
        .join("\n")
        .toLowerCase();

      return hay.includes(q);
    });
  }, [bookmarks, activeFilter, query]);

  const counts = useMemo(() => {
    const c = { all: bookmarks.length, tweet: 0, thread: 0, article: 0, text: 0 };
    for (const b of bookmarks) {
      const k = classifySource(b).kind;
      c[k] += 1;
    }
    return c;
  }, [bookmarks]);

  return (
    <div className="min-h-screen bg-radial-glow text-zinc-100">
      {/* TOP NAV */}
      <header className="sticky top-0 z-50">
        <div className="mx-auto max-w-6xl px-6">
        <div className="mt-4 glass-card rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">            <button
              type="button"
              onClick={() => scrollTo(heroRef)}
              className="flex items-center gap-3"
              aria-label="Go to top"
            >
              <div className="h-9 w-9 rounded-xl bg-white/10 soft-border flex items-center justify-center">
                <div className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
              </div>
              <div className="text-left leading-tight">
                <div className="text-sm font-semibold">BookmarkCT</div>
                <div className="text-xs text-zinc-400">Signal vault</div>
              </div>
            </button>

            <nav className="hidden sm:flex items-center gap-2">
  <button
    type="button"
    onClick={() => scrollTo(actionRef)}
    className={navPill(activeSection === "summarize")}
  >
    Summarize
  </button>
  <button
    type="button"
    onClick={() => scrollTo(vaultRef)}
    className={navPill(activeSection === "vault")}
  >
    Vault
  </button>
</nav>

            <div className="flex items-center gap-2">
              <span className="hidden md:inline-flex rounded-full bg-white/5 soft-border px-3 py-1.5 text-xs text-zinc-300">
                Demo mode
              </span>

              {isConnected ? (
                <>
                  <span className="hidden md:inline-flex rounded-full bg-emerald-500/10 soft-border px-3 py-1.5 text-xs text-emerald-200">
                    {isOnExpectedChain ? "BSC Testnet" : "Wrong network"}
                  </span>
                  <span className="inline-flex rounded-full bg-white/5 soft-border px-3 py-1.5 text-xs text-zinc-200">
                    {truncateAddress(address)}
                  </span>
                  <button
                    type="button"
                    onClick={() => disconnect()}
                    className="rounded-full bg-white/5 soft-border px-3 py-1.5 text-xs text-zinc-200 hover:bg-white/10"
                  >
                    Disconnect
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={connectWallet}
                  disabled={isConnecting}
                  className="rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-zinc-200 disabled:opacity-70"
                >
                  {isConnecting ? "Connecting…" : "Connect"}
                </button>
              )}
            </div>
          </div>

          {(walletError || connectError) && (
            <div className="mt-3 text-center text-xs text-red-300">
              {walletError ?? connectError?.message ?? ""}
            </div>
          )}

          {isConnected && !isOnExpectedChain && (
            <div className="mt-3 text-center">
              <button
                type="button"
                onClick={switchToBscTestnet}
                disabled={isSwitchingChain}
                className="rounded-full bg-amber-500 px-4 py-2 text-xs font-semibold text-zinc-900 disabled:opacity-70"
              >
                {isSwitchingChain ? "Switching…" : "Switch to BSC Testnet"}
              </button>
            </div>
          )}
        </div>
      </header>

      {/* HERO */}
      <section ref={heroRef} className="mx-auto max-w-6xl px-6 pt-24 pb-12 text-center">
      <div className="fade-up inline-flex items-center gap-2 rounded-full bg-white/5 soft-border px-4 py-2 text-xs text-zinc-300">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
          Import X, summarize, save signal
        </div>

        <h1 className="fade-up fade-up-delay-1 mt-8 text-5xl sm:text-6xl font-semibold tracking-tight text-glow">          Bookmark the signal, not the noise.
        </h1>

        <p className="fade-up fade-up-delay-2 mt-6 text-lg text-zinc-400 max-w-2xl mx-auto">          Turn long X posts, threads, and articles into concise AI summaries and save what matters.
        </p>

        <div className="fade-up fade-up-delay-3 mt-10 flex justify-center gap-3">          <button
            type="button"
            onClick={() => scrollTo(actionRef)}
            className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-zinc-900 hover:bg-zinc-200"
          >
            Summarize a post
          </button>
          <button
            type="button"
            onClick={() => scrollTo(vaultRef)}
            className="rounded-full bg-white/5 soft-border px-6 py-3 text-sm font-semibold text-zinc-200 hover:bg-white/10"
          >
            View your vault
          </button>
        </div>

        {/* FAST / SEARCHABLE / VERIFIABLE */}
        <div className="mt-14 grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
          {[
            { t: "Fast", d: "Import and summarize in seconds" },
            { t: "Searchable", d: "Find signals instantly" },
            { t: "Verifiable", d: "Optional on-chain anchor" },
          ].map((x) => (
            <div key={x.t} className="glass-card rounded-2xl p-6">
              <div className="text-sm font-semibold">{x.t}</div>
              <div className="mt-2 text-sm text-zinc-400">{x.d}</div>
            </div>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="mx-auto max-w-6xl px-6 pb-12">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          {[
            { t: "Paste X link or text", d: "Import in 1 click" },
            { t: "AI summarizes content", d: "Short, dense signal" },
            { t: "Save off-chain", d: "Instant and searchable" },
            { t: "Optionally anchor on-chain", d: "Proof of integrity" },
          ].map((s) => (
            <div key={s.t} className="glass-card rounded-2xl p-6">
              <div className="text-sm font-semibold">{s.t}</div>
              <div className="mt-2 text-sm text-zinc-400">{s.d}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ACTION */}
      <section ref={actionRef} className="mx-auto max-w-6xl px-6 py-10">
        <div className="glass-card rounded-3xl p-8 sm:p-10">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xl font-semibold">Summarize</div>
              <div className="mt-2 text-sm text-zinc-400">
                Paste text or import an X post, then generate an AI summary.
              </div>
            </div>
            <div className="text-sm text-zinc-400">
              {remainingChars.toString()} chars
            </div>
          </div>

          <div className="mt-8 flex gap-2">
            <button
              type="button"
              onClick={() => setMode("x")}
              className={cx(
                "rounded-full px-4 py-2 text-sm font-semibold",
                mode === "x" ? "bg-white text-zinc-900" : "bg-white/5 soft-border text-zinc-200 hover:bg-white/10"
              )}
            >
              From X
            </button>
            <button
              type="button"
              onClick={() => setMode("text")}
              className={cx(
                "rounded-full px-4 py-2 text-sm font-semibold",
                mode === "text" ? "bg-white text-zinc-900" : "bg-white/5 soft-border text-zinc-200 hover:bg-white/10"
              )}
            >
              Paste text
            </button>
          </div>

          <div className="mt-6">
            {mode === "x" ? (
              <>
                <input
                  value={tweetUrl}
                  onChange={(e) => setTweetUrl(e.target.value)}
                  placeholder="https://x.com/user/status/..."
                  className="w-full rounded-2xl px-4 py-4 text-sm text-zinc-100 input-dark"
                />
                <button
                  type="button"
                  onClick={handleImportFromX}
                  disabled={isImporting}
                  className="mt-4 rounded-full bg-white px-6 py-3 text-sm font-semibold text-zinc-900 hover:bg-zinc-200 disabled:opacity-70"
                >
                  {isImporting ? "Importing…" : "Import"}
                </button>
                {importError && (
                  <div className="mt-4 text-sm text-red-300">{importError}</div>
                )}
              </>
            ) : (
              <textarea
                rows={6}
                value={sourceText}
                onChange={(e) => setSourceText(e.target.value)}
                placeholder="Paste text to summarize…"
                className="w-full rounded-2xl px-4 py-4 text-sm text-zinc-100 input-dark"
              />
            )}
          </div>

          <div className="mt-5">
            <label className="text-xs text-zinc-400">Source URL (optional)</label>
            <input
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://example.com"
              className="mt-2 w-full rounded-2xl px-4 py-3 text-sm text-zinc-100 input-dark"
            />
          </div>

          <form onSubmit={handleSubmit} className="mt-6">
            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-2xl bg-emerald-500 px-6 py-4 text-sm font-semibold text-zinc-900 hover:bg-emerald-400 disabled:opacity-70"
            >
              {isLoading ? "Summarizing…" : "Generate summary"}
            </button>
          </form>

          {error && <div className="mt-4 text-sm text-red-300">{error}</div>}
        </div>
      </section>

      {/* VAULT */}
      <section ref={vaultRef} className="mx-auto max-w-6xl px-6 pb-24 pt-10">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <h2 className="text-3xl font-semibold">Your signal vault</h2>
            <p className="mt-2 text-sm text-zinc-400">
              AI-compressed insights you chose to keep.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-xs text-zinc-500">
              {filtered.length} of {bookmarks.length} signals
            </div>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your vault…"
              className="w-64 max-w-full rounded-full px-4 py-2 text-sm text-zinc-100 input-dark"
            />
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {[
            { k: "all", label: `All`, n: counts.all },
            { k: "tweet", label: `Tweet`, n: counts.tweet },
            { k: "thread", label: `Thread`, n: counts.thread },
            { k: "article", label: `Article`, n: counts.article },
            { k: "text", label: `Text`, n: counts.text },
          ].map((x) => {
            const active = activeFilter === (x.k as any);
            return (
              <button
                key={x.k}
                type="button"
                onClick={() => setActiveFilter(x.k as any)}
                className={cx(
                  "rounded-full px-4 py-2 text-sm font-semibold",
                  active
                    ? "bg-white text-zinc-900"
                    : "bg-white/5 soft-border text-zinc-200 hover:bg-white/10"
                )}
              >
                {x.label}
              </button>
            );
          })}
        </div>

        <div className="mt-6">
          {filtered.length === 0 ? (
            <div className="glass-card rounded-3xl p-10 text-center">
              <div className="text-sm font-semibold">No signals found</div>
              <div className="mt-2 text-sm text-zinc-400">
                Try another filter or search query.
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {filtered.map((b) => {
                const created = formatCreatedAt(b.createdAt);
                const meta = classifySource(b);
                const isExpanded = Boolean(expandedById[b.id]);

                const url = b.sourceUrl ?? "";
                const host = url ? shortHost(url) : "manual";

                const threadCount =
                  meta.kind === "thread"
                    ? Math.max(
                        1,
                        (b.sourceText ?? "")
                          .split("\n")
                          .filter((l) => l.trim().length > 0).length
                      )
                    : null;

                const canSaveOnchain =
                  isConnected &&
                  isContractConfigured &&
                  isOnExpectedChain &&
                  txStates[b.id]?.status !== "wallet" &&
                  txStates[b.id]?.status !== "pending";

                return (
                  <article
  key={b.id}
  className="group relative overflow-hidden rounded-3xl bg-white/5 soft-border p-7 shadow-[0_18px_70px_rgba(0,0,0,0.55)] transition hover:bg-white/7"
>
  {/* subtle sheen */}
  <div className="pointer-events-none absolute inset-0 opacity-0 transition group-hover:opacity-100">
    <div className="absolute -inset-[40%] rotate-12 bg-gradient-to-r from-transparent via-white/6 to-transparent" />
  </div>

  {/* HEADER */}
  <div className="relative flex flex-wrap items-center justify-between gap-3">
    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
      <span className="inline-flex items-center gap-2 rounded-full bg-black/25 soft-border px-3 py-1.5 text-[11px] text-zinc-200">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        <span className="font-semibold">{meta.label}</span>
        {meta.kind === "thread" && threadCount ? (
          <span className="text-zinc-400">· {threadCount} lines</span>
        ) : null}
      </span>

      <span className="text-zinc-600">·</span>
      <span>{created}</span>

      {b.tweetAuthorId ? (
        <>
          <span className="text-zinc-600">·</span>
          <span className="truncate">author {b.tweetAuthorId}</span>
        </>
      ) : null}
    </div>

    <div className="flex items-center gap-2">
      {b.sourceUrl ? (
        <button
          type="button"
          onClick={() => copyToClipboard(b.sourceUrl!)}
          className="rounded-full bg-black/25 soft-border px-4 py-2 text-xs font-semibold text-zinc-200 hover:bg-black/35"
        >
          Copy link
        </button>
      ) : null}

      <button
        type="button"
        onClick={() => copyToClipboard(b.summary)}
        className="rounded-full bg-black/25 soft-border px-4 py-2 text-xs font-semibold text-zinc-200 hover:bg-black/35"
      >
        Copy summary
      </button>
    </div>
  </div>

  {/* SUMMARY */}
  <div className="relative mt-5">
    <div
      className="text-[15px] leading-relaxed text-zinc-100"
      style={
        isExpanded
          ? undefined
          : {
              display: "-webkit-box",
              WebkitLineClamp: 5,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }
      }
    >
      {b.summary}
    </div>

    {!isExpanded ? (
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-black/25 to-transparent" />
    ) : null}
  </div>

  {/* SOURCE */}
  <div className="relative mt-3 text-xs text-zinc-500">
    {b.sourceUrl ? (
      <a
        href={b.sourceUrl}
        target="_blank"
        rel="noreferrer"
        className="underline decoration-zinc-700 underline-offset-4 hover:text-zinc-300"
      >
        {host}
      </a>
    ) : (
      <span>manual</span>
    )}
  </div>

  {/* TRANSCRIPT */}
  {b.sourceText && b.sourceText.trim().length > 0 ? (
    <div className="relative mt-5 rounded-2xl bg-black/25 soft-border px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold text-zinc-200">
          {isExpanded ? "Full transcript" : "Transcript preview"}
        </div>
        <div className="text-[11px] text-zinc-500">
          {(b.sourceText?.length ?? 0).toLocaleString()} chars
        </div>
      </div>

      <div
        className={cx(
          "mt-3 whitespace-pre-wrap text-xs leading-relaxed text-zinc-400",
          isExpanded ? "max-h-80 overflow-auto pr-2" : ""
        )}
      >
        {isExpanded ? b.sourceText : clampText(b.sourceText, 360)}
      </div>
    </div>
  ) : null}

  {/* FOOTER ACTIONS */}
  <div className="relative mt-6 flex flex-wrap items-center gap-3">
    <button
      type="button"
      onClick={() => toggleExpanded(b.id)}
      className="rounded-full bg-black/25 soft-border px-5 py-2.5 text-xs font-semibold text-zinc-200 hover:bg-black/35"
    >
      {isExpanded ? "Collapse" : "Read more"}
    </button>

    <button
      type="button"
      onClick={() => handleSaveOnchain(b)}
      disabled={!canSaveOnchain}
      className="rounded-full border border-white/15 bg-transparent px-5 py-2.5 text-xs font-semibold text-zinc-200 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {txStates[b.id]?.status === "wallet"
        ? "Confirm in wallet…"
        : txStates[b.id]?.status === "pending"
        ? "Saving on-chain…"
        : "Save on-chain"}
    </button>

    {txStates[b.id]?.status === "success" ? (
      <a
        className="rounded-full bg-emerald-500/10 soft-border px-5 py-2.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/15"
        href={`https://testnet.bscscan.com/tx/${txStates[b.id]?.hash}`}
        target="_blank"
        rel="noreferrer"
      >
        View on BscScan
      </a>
    ) : null}

    {txStates[b.id]?.status === "error" ? (
      <span className="text-xs text-red-300">
        {txStates[b.id]?.error ?? "Transaction failed."}
      </span>
    ) : null}

    {!isOnExpectedChain && isConnected ? (
      <span className="text-xs text-amber-300">
        Switch to BSC Testnet to save on-chain.
      </span>
    ) : null}
  </div>
</article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-white/10">
        <div className="mx-auto max-w-6xl px-6 py-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div className="text-sm text-zinc-300">
            <div className="font-semibold">BookmarkCT</div>
            <div className="mt-1 text-xs text-zinc-500">
              Summaries saved off-chain, optional on-chain integrity anchor.
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => scrollTo(actionRef)}
              className="rounded-full bg-white/5 soft-border px-4 py-2 text-xs font-semibold text-zinc-200 hover:bg-white/10"
            >
              Summarize
            </button>
            <button
              type="button"
              onClick={() => scrollTo(vaultRef)}
              className="rounded-full bg-white/5 soft-border px-4 py-2 text-xs font-semibold text-zinc-200 hover:bg-white/10"
            >
              Vault
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}