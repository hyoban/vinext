import fs from "node:fs/promises";
import type { Server } from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test as base, expect } from "../../fixtures";

type ProductionApp = {
  baseUrl: string;
};

const requireFromVinextPackage = createRequire(
  path.resolve(process.cwd(), "packages/vinext/package.json"),
);

async function linkFixtureNodeModules(fixtureRoot: string): Promise<void> {
  await fs.symlink(
    path.resolve(process.cwd(), "tests/fixtures/app-basic/node_modules"),
    path.join(fixtureRoot, "node_modules"),
    "junction",
  );
}

async function writeWebKitHarnessFixture(fixtureRoot: string): Promise<void> {
  const refCount = 5;
  const appDir = path.join(fixtureRoot, "app");
  const routeDir = path.join(appDir, "client-reference-runtime-map");
  const clientRefsDir = path.join(fixtureRoot, "client-refs");

  await fs.mkdir(routeDir, { recursive: true });
  await fs.mkdir(clientRefsDir, { recursive: true });
  await fs.writeFile(
    path.join(fixtureRoot, "package.json"),
    `${JSON.stringify({ type: "module", dependencies: {} }, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(appDir, "layout.tsx"),
    `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <head>
        <link rel="icon" href="data:," />
      </head>
      <body>{children}</body>
    </html>
  );
}
`,
  );
  for (let index = 0; index < refCount; index++) {
    await fs.writeFile(
      path.join(clientRefsDir, `probe-${index}.tsx`),
      `"use client";
await Promise.resolve();

export function Probe${index}() {
  return <span data-probe="${index}">probe-${index}</span>;
}
`,
    );
  }

  let page = "";
  for (let index = 0; index < refCount; index++) {
    page += `import { Probe${index} } from "../../client-refs/probe-${index}";\n`;
  }
  await fs.writeFile(
    path.join(routeDir, "page.tsx"),
    `${page}
export default function WebKitClientReferenceCrashPage() {
  return (
    <main>
      <h1>Client Reference Runtime Harness</h1>
      ${Array.from({ length: refCount }, (_, index) => `<Probe${index} />`).join("\n      ")}
    </main>
  );
}
`,
  );
}

async function closeServer(server: Server): Promise<void> {
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  server.closeIdleConnections();
  server.closeAllConnections();
  await closed;
}

async function buildAndServeProductionFixture(): Promise<{
  fixtureRoot: string;
  server: Server;
  app: ProductionApp;
}> {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vinext-client-reference-"));

  await linkFixtureNodeModules(fixtureRoot);
  await writeWebKitHarnessFixture(fixtureRoot);

  const configFile = path.join(fixtureRoot, "vite.config.ts");
  const vinextSource = path.resolve(process.cwd(), "packages/vinext/src/index.ts");
  const reactPluginSource = requireFromVinextPackage.resolve("@vitejs/plugin-react");
  await fs.writeFile(
    configFile,
    `import { defineConfig } from "vite";
import react from ${JSON.stringify(pathToFileURL(reactPluginSource).href)};
import vinext from ${JSON.stringify(pathToFileURL(vinextSource).href)};

export default defineConfig({
  plugins: [react(), vinext({ appDir: import.meta.dirname, react: false })],
});
`,
  );

  const { createBuilder } = await import("vite");
  const builder = await createBuilder({
    root: fixtureRoot,
    configFile,
    logLevel: "silent",
  });
  await builder.buildApp();

  const { startProdServer } = await import(
    pathToFileURL(path.resolve(process.cwd(), "packages/vinext/dist/server/prod-server.js")).href
  );
  const started = await startProdServer({
    host: "127.0.0.1",
    port: 0,
    outDir: path.join(fixtureRoot, "dist"),
    noCompression: true,
  });

  return {
    fixtureRoot,
    server: started.server,
    app: {
      baseUrl: `http://127.0.0.1:${started.port}`,
    },
  };
}

const test = base.extend<{ productionApp: ProductionApp }>({
  // oxlint-disable-next-line eslint-plugin-react-hooks/rules-of-hooks, eslint/no-empty-pattern
  productionApp: async ({}, use) => {
    const { fixtureRoot, server, app } = await buildAndServeProductionFixture();

    try {
      await use(app);
    } finally {
      await closeServer(server);
      await fs.rm(fixtureRoot, { recursive: true, force: true });
    }
  },
});

test.describe("App Router client reference runtime map", () => {
  test("serves the production build without undefined RSC client references", async ({
    page,
    productionApp,
    consoleErrors,
  }) => {
    const response = await page.goto(
      `${productionApp.baseUrl}/client-reference-runtime-map?q=${Date.now()}`,
      { waitUntil: "load" },
    );

    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { name: "Client Reference Runtime Harness" }),
    ).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });
});
