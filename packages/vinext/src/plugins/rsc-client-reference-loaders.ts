import type { Plugin } from "vite";
import type { PluginApi } from "@vitejs/plugin-rsc";

const CLIENT_REFERENCES_ID = "\0virtual:vite-rsc/client-references";
const RESOLVED_ID_PROXY_PREFIX = "virtual:vite-rsc/resolved-id/";

type RscClientReferenceMeta = PluginApi["manager"]["clientReferenceMetaMap"][string];

type RscPluginWithApi = Plugin & {
  api?: PluginApi;
};

function withResolvedIdProxy(resolvedId: string): string {
  return resolvedId.startsWith("\0")
    ? RESOLVED_ID_PROXY_PREFIX + encodeURIComponent(resolvedId)
    : resolvedId;
}

function generateClientReferenceObject(meta: RscClientReferenceMeta): string {
  const exports = meta.renderedExports
    .slice()
    .sort()
    .map((name) => `      get ${JSON.stringify(name)}() { return m[${JSON.stringify(name)}]; },`)
    .join("\n");

  return exports ? `{\n${exports}\n    }` : "{}";
}

function generateDirectClientReferenceLoaders(metas: RscClientReferenceMeta[]): string {
  const entries = metas
    .slice()
    .sort((a, b) => a.referenceKey.localeCompare(b.referenceKey))
    .map((meta) => {
      const importId = withResolvedIdProxy(meta.importId);
      return [
        `  ${JSON.stringify(meta.referenceKey)}: async () => {`,
        `    const m = await import(${JSON.stringify(importId)});`,
        `    return ${generateClientReferenceObject(meta)};`,
        `  },`,
      ].join("\n");
    })
    .join("\n");

  return `export default {\n${entries}\n};\n`;
}

export function createRscClientReferenceLoadersPlugin(): Plugin {
  let rscApi: PluginApi | undefined;

  return {
    name: "vinext:rsc-client-reference-loaders",
    enforce: "post",
    configResolved(config) {
      rscApi = (
        config.plugins.find((plugin) => plugin.name === "rsc:minimal") as
          | RscPluginWithApi
          | undefined
      )?.api;
    },
    transform(_code, id) {
      if (id !== CLIENT_REFERENCES_ID) return null;

      const manager = rscApi?.manager;
      if (!manager || manager.isScanBuild) return null;

      const metaEntries = Object.entries(manager.clientReferenceMetaMap ?? {}).filter(
        ([, meta]) => meta.serverChunk,
      );
      const metas = metaEntries.map(([, meta]) => meta);
      if (metas.length === 0) return null;

      for (const [id, meta] of metaEntries) {
        // The RSC assets manifest reads this field to collect JS/CSS deps.
        meta.groupChunkId = id;
      }

      return {
        code: generateDirectClientReferenceLoaders(metas),
        map: null,
      };
    },
  };
}
