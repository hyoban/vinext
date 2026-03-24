import { resolveRuntimeEntryModule } from "./runtime-entry-module.js";

/**
 * Generate the virtual browser entry module.
 *
 * This runs in the client (browser). It hydrates the page from the
 * embedded RSC payload and handles client-side navigation by re-fetching
 * RSC streams.
 */
export function generateBrowserEntry(instrumentationClientPath?: string | null): string {
  const entryPath = resolveRuntimeEntryModule("app-browser-entry");
  const normalizedInstrumentationPath = instrumentationClientPath?.replace(/\\/g, "/");
  const instrumentationClientImport = normalizedInstrumentationPath
    ? `import * as __instrumentationClient from ${JSON.stringify(normalizedInstrumentationPath)};`
    : `const __instrumentationClient = null;`;
  const instrumentationClientHmr = normalizedInstrumentationPath
    ? `
if (import.meta.hot) {
  import.meta.hot.accept(${JSON.stringify(normalizedInstrumentationPath)}, (mod) => {
    setClientInstrumentationHooks(mod);
  });
}
`
    : "";

  return `import { setClientInstrumentationHooks } from "vinext/client-instrumentation";
import { bootstrapAppBrowserEntry } from ${JSON.stringify(entryPath)};

${instrumentationClientImport}
setClientInstrumentationHooks(__instrumentationClient);
${instrumentationClientHmr}

void bootstrapAppBrowserEntry();
`;
}
