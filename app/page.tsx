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
};

const MAX_SOURCE_TEXT_LENGTH = 10_000;
const MAX_SUMMARY_PREVIEW = 200;

type TxState = {
  status: "idle" | "wallet" | "pending" | "success" | "error";
  hash?: `0x${string}`;
  error?: string;
};

export default function Home() {
  const [sourceText, setSourceText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txStates, setTxStates] = useState<Record<string, TxState>>({});

  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connect, connectors, isPending: isConnecting, error: connectError } =
    useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync, isPending: isSwitching, error: switchError } =
    useSwitchChain();
  const publicClient = usePublicClient({ chainId: onchainConfig.chainId });
  const { writeContractAsync } = useWriteContract();

  const contractAddress =
    typeof onchainConfig.address === "string" ? onchainConfig.address : "";
  const isContractConfigured = Boolean(contractAddress);

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

  const preferredConnector = useMemo(() => {
    // injected({ target: "metaMask" }) heißt in der UI typischerweise "MetaMask"
    const metaMaskLike = connectors.find(
      (c) => (c.name || "").toLowerCase() === "metamask"
    );
    return metaMaskLike ?? connectors[0];
  }, [connectors]);

  const ensureBscTestnet = async () => {
    if (chainId === onchainConfig.chainId) return;
    if (!switchChainAsync) {
      throw new Error(
        `Wrong network. Please switch to BSC Testnet (chainId ${onchainConfig.chainId}).`
      );
    }
    await switchChainAsync({ chainId: onchainConfig.chainId });
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

    setError(null);
    setTxStates((prev) => ({
      ...prev,
      [bookmark.id]: { status: "wallet" },
    }));

    try {
      // Fix für deinen Error: wenn Wallet auf Chain 1 ist, zuerst auf 97 wechseln
      await ensureBscTestnet();

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
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Wallet</h2>
              <p className="text-sm text-zinc-600">
                Connect MetaMask on BNB Smart Chain Testnet.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {isConnected ? (
                <>
                  <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-700">
                    {address}
                  </span>
                  <button
                    type="button"
                    onClick={() => disconnect()}
                    className="rounded-full border border-zinc-200 px-4 py-2 text-xs font-semibold text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50"
                  >
                    Disconnect
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    if (!preferredConnector) {
                      setError("No injected wallet found. Enable MetaMask extension.");
                      return;
                    }
                    connect({ connector: preferredConnector });
                  }}
                  disabled={isConnecting}
                  className="rounded-full bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isConnecting ? "Connecting..." : "Connect Wallet"}
                </button>
              )}
            </div>
          </div>

          {connectError ? (
            <p className="mt-3 text-xs text-red-600">{connectError.message}</p>
          ) : null}

          {switchError ? (
            <p className="mt-3 text-xs text-red-600">{switchError.message}</p>
          ) : null}

          {!isContractConfigured ? (
            <p className="mt-3 text-sm text-amber-700">Deploy the contract first.</p>
          ) : null}

          {isConnected && chainId !== onchainConfig.chainId ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <p className="text-sm text-amber-700">
                Wrong network. Please switch to BSC Testnet.
              </p>
              <button
                type="button"
                onClick={() => switchChainAsync({ chainId: onchainConfig.chainId })}
                disabled={isSwitching}
                className="rounded-full border border-zinc-200 px-4 py-2 text-xs font-semibold text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isSwitching ? "Switching..." : "Switch Network"}
              </button>
            </div>
          ) : null}
        </section>

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
            <span className="text-sm text-zinc-500">{bookmarks.length} total</span>
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
                    <span>{new Date(bookmark.createdAt).toLocaleString()}</span>
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

                  <div className="mt-4 flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => handleSaveOnchain(bookmark)}
                      disabled={
                        !isConnected ||
                        !isContractConfigured ||
                        txStates[bookmark.id]?.status === "wallet" ||
                        txStates[bookmark.id]?.status === "pending"
                      }
                      className="inline-flex items-center justify-center rounded-xl border border-zinc-200 px-4 py-2 text-xs font-semibold text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Save on-chain
                    </button>

                    {txStates[bookmark.id]?.status === "wallet" ? (
                      <span className="text-xs text-zinc-500">
                        Confirm in wallet…
                      </span>
                    ) : null}

                    {txStates[bookmark.id]?.status === "pending" ? (
                      <span className="text-xs text-zinc-500">Pending…</span>
                    ) : null}

                    {txStates[bookmark.id]?.status === "success" ? (
                      <a
                        className="text-xs text-emerald-700 underline decoration-emerald-300 underline-offset-4"
                        href={`https://testnet.bscscan.com/tx/${txStates[bookmark.id]?.hash}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View transaction on BscScan
                      </a>
                    ) : null}

                    {txStates[bookmark.id]?.status === "error" ? (
                      <span className="text-xs text-red-600">
                        {txStates[bookmark.id]?.error ?? "Transaction failed."}
                      </span>
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
