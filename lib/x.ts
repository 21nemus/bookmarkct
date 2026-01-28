// lib/x.ts
export function extractTweetId(inputUrl: string): string | null {
    try {
      const url = new URL(inputUrl.trim());
  
      // Accept x.com and twitter.com
      const host = url.hostname.replace(/^www\./, "");
      if (host !== "x.com" && host !== "twitter.com") return null;
  
      // Typical formats:
      // https://x.com/{user}/status/{id}
      // https://twitter.com/{user}/status/{id}
      // Sometimes /i/web/status/{id}
      const parts = url.pathname.split("/").filter(Boolean);
      const statusIdx = parts.findIndex((p) => p === "status");
      if (statusIdx !== -1 && parts[statusIdx + 1]) {
        const id = parts[statusIdx + 1];
        if (/^\d+$/.test(id)) return id;
      }
  
      const webStatusIdx = parts.findIndex((p) => p === "web");
      if (webStatusIdx !== -1) {
        const maybeStatusIdx = parts.findIndex((p) => p === "status");
        if (maybeStatusIdx !== -1 && parts[maybeStatusIdx + 1]) {
          const id = parts[maybeStatusIdx + 1];
          if (/^\d+$/.test(id)) return id;
        }
      }
  
      return null;
    } catch {
      return null;
    }
  }