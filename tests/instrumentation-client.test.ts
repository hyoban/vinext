import { describe, it, expect, vi, beforeEach, afterEach } from "vite-plus/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createValidFileMatcher } from "../packages/vinext/src/routing/file-matcher.js";

describe("findInstrumentationClientFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vinext-inst-client-"));
  });

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("prefers src/ over the project root", async () => {
    fs.writeFileSync(path.join(tmpDir, "instrumentation-client.ts"), "");
    fs.mkdirSync(path.join(tmpDir, "src"));
    fs.writeFileSync(path.join(tmpDir, "src", "instrumentation-client.ts"), "");

    const { findInstrumentationClientFile } =
      await import("../packages/vinext/src/server/instrumentation-client.js");

    expect(findInstrumentationClientFile(tmpDir, createValidFileMatcher())).toBe(
      path.join(tmpDir, "src", "instrumentation-client.ts"),
    );
  });

  it("falls back to the project root when src/ is absent", async () => {
    fs.writeFileSync(path.join(tmpDir, "instrumentation-client.ts"), "");

    const { findInstrumentationClientFile } =
      await import("../packages/vinext/src/server/instrumentation-client.js");

    expect(findInstrumentationClientFile(tmpDir, createValidFileMatcher())).toBe(
      path.join(tmpDir, "instrumentation-client.ts"),
    );
  });

  it("returns null when no instrumentation-client file exists", async () => {
    const { findInstrumentationClientFile } =
      await import("../packages/vinext/src/server/instrumentation-client.js");

    expect(findInstrumentationClientFile(tmpDir, createValidFileMatcher())).toBeNull();
  });
});

describe("client instrumentation runtime", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.restoreAllMocks();
  });

  it("is a no-op when no loader is provided", async () => {
    const { ensureClientInstrumentation, getClientInstrumentationHooks } =
      await import("../packages/vinext/src/client/instrumentation-client.js");

    await expect(ensureClientInstrumentation()).resolves.toBeNull();
    expect(getClientInstrumentationHooks()).toBeNull();
  });

  it("stores onRouterTransitionStart and notifies it later", async () => {
    const {
      ensureClientInstrumentation,
      getClientInstrumentationHooks,
      notifyRouterTransitionStart,
    } = await import("../packages/vinext/src/client/instrumentation-client.js");
    const onRouterTransitionStart = vi.fn();

    await ensureClientInstrumentation(async () => ({ onRouterTransitionStart }));

    expect(getClientInstrumentationHooks()?.onRouterTransitionStart).toBe(onRouterTransitionStart);

    notifyRouterTransitionStart("/about", "push");
    expect(onRouterTransitionStart).toHaveBeenCalledWith("/about", "push");
  });

  it("logs a dev warning when execution exceeds 16ms", async () => {
    process.env.NODE_ENV = "development";
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const nowSpy = vi.spyOn(performance, "now");
    nowSpy.mockReturnValueOnce(0).mockReturnValueOnce(20);

    const { ensureClientInstrumentation } =
      await import("../packages/vinext/src/client/instrumentation-client.js");

    await ensureClientInstrumentation(async () => ({}));

    expect(consoleSpy).toHaveBeenCalledWith(
      "[Client Instrumentation Hook] Slow execution detected: 20ms " +
        "(Note: Code download overhead is not included in this measurement)",
    );
  });
});
