import * as React from "react";

const LAYOUT_SEGMENT_CONTEXT_KEY = Symbol.for("vinext.layoutSegmentContext");

type GlobalWithLayoutSegmentContext = typeof globalThis & {
  [LAYOUT_SEGMENT_CONTEXT_KEY]?: React.Context<string[]> | null;
};

/**
 * Return a single shared layout segment context for the current JS realm.
 *
 * Using globalThis avoids provider/hook mismatches when bundlers end up
 * instantiating the shim module more than once under different IDs.
 */
export function getLayoutSegmentContext(): React.Context<string[]> | null {
  if (typeof React.createContext !== "function") return null;

  const globalState = globalThis as GlobalWithLayoutSegmentContext;
  if (!globalState[LAYOUT_SEGMENT_CONTEXT_KEY]) {
    globalState[LAYOUT_SEGMENT_CONTEXT_KEY] = React.createContext<string[]>([]);
  }

  return globalState[LAYOUT_SEGMENT_CONTEXT_KEY] ?? null;
}
