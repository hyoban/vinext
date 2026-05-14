import { hasBasePath, stripBasePath } from "../utils/base-path.js";

export type LinkPrefetchIntent = "viewport" | "intent";
export type LinkPrefetchPriority = "low" | "high";

export type LinkPrefetchDecision =
  | {
      shouldPrefetch: false;
    }
  | {
      shouldPrefetch: true;
      priority: LinkPrefetchPriority;
    };

export function canLinkPrefetch(input: {
  nodeEnv: string | undefined;
  prefetch: boolean | null | undefined;
  isDangerous: boolean;
}): boolean {
  return input.nodeEnv === "production" && input.prefetch !== false && !input.isDangerous;
}

export function getLinkPrefetchDecision(input: {
  nodeEnv: string | undefined;
  prefetch: boolean | null | undefined;
  isDangerous: boolean;
  intent: LinkPrefetchIntent;
}): LinkPrefetchDecision {
  if (!canLinkPrefetch(input)) return { shouldPrefetch: false };

  return {
    shouldPrefetch: true,
    priority: input.intent === "intent" ? "high" : "low",
  };
}

/**
 * Normalize absolute and protocol-relative Link hrefs to app-relative paths
 * that are eligible for prefetching. Non-absolute relative hrefs are returned
 * unchanged; callers must resolve them against the current browser URL before
 * constructing a concrete fetch target.
 */
export function getLinkPrefetchHref(input: {
  href: string;
  basePath: string;
  currentOrigin: string | undefined;
}): string | null {
  const { href, basePath, currentOrigin } = input;
  if (!isAbsoluteOrProtocolRelative(href)) return href;
  if (currentOrigin === undefined) return null;

  try {
    const current = new URL(currentOrigin);
    const parsed = href.startsWith("//") ? new URL(href, current.origin) : new URL(href);
    if (parsed.origin !== current.origin) return null;

    if (!basePath) {
      return parsed.pathname + parsed.search + parsed.hash;
    }

    if (!hasBasePath(parsed.pathname, basePath)) {
      return null;
    }

    return stripBasePath(parsed.pathname, basePath) + parsed.search + parsed.hash;
  } catch {
    return null;
  }
}

function isAbsoluteOrProtocolRelative(href: string): boolean {
  return href.startsWith("http://") || href.startsWith("https://") || href.startsWith("//");
}
