import { resolveRuntimeModule } from "./runtime-entry-module.js";

const timingModulePath = resolveRuntimeModule("../client/require-instrumentation-client");

function normalizeInstrumentationClientPath(path?: string | null) {
  return path?.replace(/\\/g, "/") ?? null;
}

function renderSideEffectImport(specifier: string) {
  return `import ${JSON.stringify(specifier)};`;
}

function renderNamespaceImport(binding: string, specifier: string) {
  return `import * as ${binding} from ${JSON.stringify(specifier)};`;
}

function renderInstrumentationTimingImports(modulePath: string) {
  return [
    renderSideEffectImport(`${timingModulePath}?vinext-instrumentation=start`),
    modulePath,
    renderSideEffectImport(`${timingModulePath}?vinext-instrumentation=end`),
  ].join("\n");
}

function renderInstrumentationClientHmr(modulePath: string, callbackBody?: string) {
  if (!callbackBody) {
    return `
if (import.meta.hot) {
  import.meta.hot.accept(${JSON.stringify(modulePath)});
}
`;
  }

  return `
if (import.meta.hot) {
  import.meta.hot.accept(${JSON.stringify(modulePath)}, (mod) => {
${callbackBody}
  });
}
`;
}

export function createAppInstrumentationClientEntry(path?: string | null) {
  const modulePath = normalizeInstrumentationClientPath(path);
  if (!modulePath) {
    return {
      imports: "",
      binding: "null",
      hmr: "",
    };
  }

  return {
    imports: renderInstrumentationTimingImports(
      renderNamespaceImport("__instrumentationClient", modulePath),
    ),
    binding: "__instrumentationClient",
    hmr: renderInstrumentationClientHmr(modulePath, "    setClientInstrumentationHooks(mod);"),
  };
}

export function createPagesInstrumentationClientEntry(path?: string | null) {
  const modulePath = normalizeInstrumentationClientPath(path);
  if (!modulePath) {
    return {
      imports: "",
      hmr: "",
    };
  }

  return {
    imports: renderInstrumentationTimingImports(renderSideEffectImport(modulePath)),
    hmr: renderInstrumentationClientHmr(modulePath),
  };
}
