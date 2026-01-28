"use client";

import { useEffect, useMemo, useState } from "react";
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

const MAX_SOURCE_TEXT_LENGTH = 10_000;
const MAX_SUMMARY_PREVIEW = 200;

type TxState = {
  status: "idle" | "wallet" | "pending" | "success" | "error";
  hash?: `0x${string}`;
  error?: string;
};

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

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function shortenUrl(raw: string, max = 48) {
  try {
    const u = new URL(raw);
    const s = `${u.hostname}${u.pathname}${u.search}`;
    if (s.length <= max) return s;
    return s.slice(0, Math.max(0, max - 1)) + "…";
  } catch {
    if (raw.length <= max) return raw;
    return raw.slice(0, Math.max(0, max - 1)) + "…";
  }
}

function formatCreatedAtIso(createdAt: string) {
  const created = new Date(createdAt).toISOString().replace("T", " ").slice(0, 19);
  return created;
}

export default function Home() {
  const [sourceText, setSourceText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [tweetUrl, setTweetUrl] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const [tweetMeta, setTweetMeta] = useState<TweetMeta | null>(null);

  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txStates, setTxStates] = useState<Record<string, TxState>>({});

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

  const remainingChars = useMemo(
    () => MAX_SOURCE_TEXT_LENGTH - sourceText.length,
    [sourceText.length]
  );

  const loadBookmarks = async () => {
    try {
      const response = await fetch("/api/bookmarks", { cache: "no-store" });
      if (!response.ok) throw new Error("Failed to load bookmarks.");
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

  const handleImportFromX = async () => {
    setImportError(null);
    setError(null);

    const trimmed = tweetUrl.trim();
    if (!trimmed) {
      setImportError("Paste an X/Twitter status URL first.");
      return;
    }

    setIsImporting(true);
    try {
      const res = await fetch(`/api/tweet?url=${encodeURIComponent(trimmed)}`, {
        cache: "no-store",
      });

      const payload = (await res.json()) as TweetApiOk | TweetApiErr;

      if (!res.ok || !payload.ok) {
        const msg =
          "ok" in payload ? "Import failed." : (payload.error ?? "Import failed.");
        throw new Error(msg);
      }

      setSourceText(payload.text);
      setSourceUrl(payload.url);

      setTweetMeta({
        tweetId: payload.id,
        tweetAuthorId: payload.authorId ?? null,
        tweetCreatedAt: payload.createdAt ?? null,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Import failed.";
      setImportError(msg);
      setTweetMeta(null);
    } finally {
      setIsImporting(false);
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
    setTxStates((prev) => ({
      ...prev,
      [bookmark.id]: { status: "wallet" },
    }));

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
          tweetId: tweetMeta?.tweetId ?? undefined,
          tweetAuthorId: tweetMeta?.tweetAuthorId ?? undefined,
          tweetCreatedAt: tweetMeta?.tweetCreatedAt ?? undefined,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Failed to create bookmark.");
      }

      setSourceText("");
      setSourceUrl("");
      setTweetUrl("");
      setImportError(null);
      setTweetMeta(null);

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

  const connectWallet = async () => {
    setWalletError(null);

    if (!isMetaMaskInstalled()) {
      setWalletError(
        "MetaMask not detected. Make sure the MetaMask extension is enabled for this browser profile."
      );
      return;
    }

    const injectedConnector = connectors[0];
    if (!injectedConnector) {
      setWalletError("No wallet connector available.");
      return;
    }

    connect({ connector: injectedConnector });
  };

  const switchToBscTestnet = async () => {
    setWalletError(null);
    try {
      await switchChainAsync({ chainId: expectedChainId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to switch network.";
      setWalletError(msg);
    }
  };

  return (
    <div className="dark min-h-screen bg-zinc-950 text-zinc-50">
      {/* subtle background */}
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.18),transparent_55%),radial-gradient(ellipse_at_bottom,rgba(16,185,129,0.10),transparent_55%)]" />

      <main className="relative mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-10 sm:px-8 lg:px-10">
        {/* Top header */}
        <header className="flex flex-col gap-3">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">BookmarkCT</h1>
              <p className="mt-2 text-sm text-zinc-300">
                Import X posts, generate AI summaries, and save the signal.
              </p>
            </div>
            <div className="hidden sm:block">
              <span className="rounded-full border border-zinc-800 bg-zinc-950/60 px-3 py-1 text-xs text-zinc-300">
                Demo mode
              </span>
            </div>
          </div>
        </header>

        {/* Wallet card */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.03)] backdrop-blur">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Wallet</h2>
              <p className="mt-1 text-xs text-zinc-400">
                Connect MetaMask on BNB Smart Chain Testnet.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {isConnected ? (
                <>
                  <span className="rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1 text-xs text-zinc-200">
                    {address}
                  </span>

                  {!isOnExpectedChain ? (
                    <button
                      type="button"
                      onClick={switchToBscTestnet}
                      disabled={isSwitchingChain}
                      className="rounded-full bg-amber-500 px-4 py-2 text-xs font-semibold text-zinc-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {isSwitchingChain ? "Switching..." : "Switch to BSC Testnet"}
                    </button>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => disconnect()}
                    className="rounded-full border border-zinc-800 bg-zinc-950/30 px-4 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-900/40"
                  >
                    Disconnect
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={connectWallet}
                  disabled={isConnecting}
                  className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-zinc-950 hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isConnecting ? "Connecting..." : "Connect Wallet"}
                </button>
              )}
            </div>
          </div>

          {connectError ? (
            <p className="mt-3 text-xs text-red-400">{connectError.message}</p>
          ) : null}
          {walletError ? <p className="mt-3 text-xs text-red-400">{walletError}</p> : null}
          {!isContractConfigured ? (
            <p className="mt-3 text-xs text-amber-300">Deploy the contract first.</p>
          ) : null}
          {isConnected && !isOnExpectedChain ? (
            <p className="mt-2 text-xs text-amber-300">
              Wrong network. Expected BNB Smart Chain Testnet (chainId 97).
            </p>
          ) : null}
        </section>

        {/* Import card */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.03)] backdrop-blur">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Import from X</h2>
              <p className="mt-1 text-xs text-zinc-400">
                Paste a status URL and we&apos;ll fetch the post text automatically.
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input
              type="url"
              value={tweetUrl}
              onChange={(e) => setTweetUrl(e.target.value)}
              className="w-full flex-1 rounded-xl border border-zinc-800 bg-zinc-950/40 px-4 py-3 text-sm text-zinc-100 shadow-sm placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none focus:ring-2 focus:ring-zinc-800"
              placeholder="https://x.com/<user>/status/<id>"
            />
            <button
              type="button"
              onClick={handleImportFromX}
              disabled={isImporting}
              className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-zinc-950 hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isImporting ? "Importing..." : "Import"}
            </button>
          </div>

          {importError ? (
            <div className="mt-3 rounded-xl border border-red-900/40 bg-red-950/40 px-4 py-3 text-sm text-red-200">
              {importError}
            </div>
          ) : null}

          {tweetMeta ? (
            <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950/40 px-4 py-3 text-xs text-zinc-300">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-zinc-100">Tweet metadata</span>
                <span className="text-zinc-500">id: {tweetMeta.tweetId}</span>
              </div>
              <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
                <div>authorId: {tweetMeta.tweetAuthorId ?? "-"}</div>
                <div>createdAt: {tweetMeta.tweetCreatedAt ?? "-"}</div>
              </div>
            </div>
          ) : null}
        </section>

        {/* Create bookmark */}
        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.03)] backdrop-blur"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Summarize</h2>
              <p className="mt-1 text-xs text-zinc-400">
                Paste text or import a post, then generate an AI summary.
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-4">
            <div>
              <label htmlFor="sourceText" className="text-xs font-medium text-zinc-300">
                Source text
              </label>
              <textarea
                id="sourceText"
                name="sourceText"
                rows={7}
                value={sourceText}
                onChange={(event) => setSourceText(event.target.value)}
                maxLength={MAX_SOURCE_TEXT_LENGTH}
                className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-950/40 px-4 py-3 text-sm text-zinc-100 shadow-sm placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none focus:ring-2 focus:ring-zinc-800"
                placeholder="Paste text to summarize..."
              />
              <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
                <span>{remainingChars} chars remaining</span>
                <span className="rounded-full border border-zinc-800 bg-zinc-950/40 px-2 py-0.5">
                  Max {MAX_SOURCE_TEXT_LENGTH.toLocaleString()}
                </span>
              </div>
            </div>

            <div>
              <label htmlFor="sourceUrl" className="text-xs font-medium text-zinc-300">
                Source URL (optional)
              </label>
              <input
                id="sourceUrl"
                name="sourceUrl"
                type="url"
                value={sourceUrl}
                onChange={(event) => setSourceUrl(event.target.value)}
                className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-950/40 px-4 py-3 text-sm text-zinc-100 shadow-sm placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none focus:ring-2 focus:ring-zinc-800"
                placeholder="https://example.com"
              />
            </div>

            {error ? (
              <div className="rounded-xl border border-red-900/40 bg-red-950/40 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={isLoading}
              className="inline-flex items-center justify-center rounded-xl bg-white px-5 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isLoading ? "Summarizing..." : "Summarize & Save"}
            </button>
          </div>
        </form>

        {/* Saved bookmarks */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-100">Saved bookmarks</h2>
            <span className="text-xs text-zinc-400">{bookmarks.length} total</span>
          </div>

          {bookmarks.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/40 p-10 text-center text-sm text-zinc-400">
              No bookmarks yet. Add your first summary above.
            </div>
          ) : (
            <div className="space-y-4">
              {bookmarks.map((bookmark) => {
                const created = formatCreatedAtIso(bookmark.createdAt);

                return (
                  <article
                    key={bookmark.id}
                    className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.03)] backdrop-blur"
                  >
                    <div className="flex flex-col gap-3">
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">
                        {bookmark.summary}
                      </p>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-zinc-400">
                        <span className="rounded-full border border-zinc-800 bg-zinc-950/40 px-2 py-0.5">
                          {created}
                        </span>

                        {bookmark.sourceUrl ? (
                          <a
                            href={bookmark.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-full border border-zinc-800 bg-zinc-950/40 px-2 py-0.5 text-zinc-200 hover:bg-zinc-900/40"
                            title={bookmark.sourceUrl}
                          >
                            {shortenUrl(bookmark.sourceUrl)}
                          </a>
                        ) : null}
                      </div>

                      {bookmark.tweetId ? (
                        <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-4 py-3 text-xs text-zinc-300">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-semibold text-zinc-100">Tweet metadata</span>
                            <span className="text-zinc-500">id: {bookmark.tweetId}</span>
                          </div>
                          <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
                            <div>authorId: {bookmark.tweetAuthorId ?? "-"}</div>
                            <div>createdAt: {bookmark.tweetCreatedAt ?? "-"}</div>
                          </div>
                        </div>
                      ) : null}

                      <div className="mt-1 flex flex-col gap-2">
                        <button
                          type="button"
                          onClick={() => handleSaveOnchain(bookmark)}
                          disabled={
                            !isConnected ||
                            !isContractConfigured ||
                            !isOnExpectedChain ||
                            txStates[bookmark.id]?.status === "wallet" ||
                            txStates[bookmark.id]?.status === "pending"
                          }
                          className={cx(
                            "inline-flex items-center justify-center rounded-xl px-4 py-2 text-xs font-semibold transition",
                            "border border-zinc-800 bg-zinc-950/30 text-zinc-200 hover:bg-zinc-900/40",
                            "disabled:cursor-not-allowed disabled:opacity-60"
                          )}
                        >
                          Save on-chain
                        </button>

                        {txStates[bookmark.id]?.status === "wallet" ? (
                          <span className="text-xs text-zinc-400">Confirm in wallet…</span>
                        ) : null}

                        {txStates[bookmark.id]?.status === "pending" ? (
                          <span className="text-xs text-zinc-400">Pending…</span>
                        ) : null}

                        {txStates[bookmark.id]?.status === "success" ? (
                          <a
                            className="text-xs text-emerald-300 underline decoration-emerald-600/40 underline-offset-4"
                            href={`https://testnet.bscscan.com/tx/${txStates[bookmark.id]?.hash}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            View transaction on BscScan
                          </a>
                        ) : null}

                        {txStates[bookmark.id]?.status === "error" ? (
                          <span className="text-xs text-red-300">
                            {txStates[bookmark.id]?.error ?? "Transaction failed."}
                          </span>
                        ) : null}

                        {!isOnExpectedChain && isConnected ? (
                          <span className="text-xs text-amber-300">
                            Switch to BSC Testnet to save on-chain.
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}