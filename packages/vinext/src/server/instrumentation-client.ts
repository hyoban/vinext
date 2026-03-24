/**
 * instrumentation-client.ts support
 *
 * Next.js resolves the client instrumentation hook from `src/` first, then
 * falls back to the project root. We mirror that alias order here so vinext's
 * file convention matches current Next.js canary behavior.
 */

import fs from "node:fs";
import path from "node:path";
import { ValidFileMatcher } from "../routing/file-matcher.js";

const INSTRUMENTATION_CLIENT_LOCATIONS = ["src/", ""];

/**
 * Find the instrumentation-client file in the project root or `src/`.
 */
export function findInstrumentationClientFile(
  root: string,
  fileMatcher: ValidFileMatcher,
): string | null {
  for (const dir of INSTRUMENTATION_CLIENT_LOCATIONS) {
    for (const ext of fileMatcher.dottedExtensions) {
      const fullPath = path.join(root, dir, `instrumentation-client${ext}`);
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }
  }
  return null;
}
