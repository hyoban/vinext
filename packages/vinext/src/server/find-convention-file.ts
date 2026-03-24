import fs from "node:fs";
import path from "node:path";

interface FindConventionFileOptions {
  root: string;
  baseNames: readonly string[];
  locations: readonly string[];
  extensions: readonly string[];
}

export function findConventionFile({
  root,
  baseNames,
  locations,
  extensions,
}: FindConventionFileOptions): string | null {
  for (const location of locations) {
    for (const baseName of baseNames) {
      for (const extension of extensions) {
        const fullPath = path.join(root, location, `${baseName}${extension}`);
        if (fs.existsSync(fullPath)) {
          return fullPath;
        }
      }
    }
  }

  return null;
}
