const THRESHOLD_MS = 16;
const START_TIME_KEY = "__VINEXT_INSTRUMENTATION_CLIENT_START_TIME__";

type InstrumentationTimingGlobal = typeof globalThis & {
  [START_TIME_KEY]?: number;
};

export function beginClientInstrumentationTiming(): void {
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  (globalThis as InstrumentationTimingGlobal)[START_TIME_KEY] = performance.now();
}

export function endClientInstrumentationTiming(): void {
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  const timingGlobal = globalThis as InstrumentationTimingGlobal;
  const startTime = timingGlobal[START_TIME_KEY];
  delete timingGlobal[START_TIME_KEY];

  if (typeof startTime !== "number") {
    return;
  }

  const duration = performance.now() - startTime;
  if (duration > THRESHOLD_MS) {
    console.log(
      `[Client Instrumentation Hook] Slow execution detected: ${duration.toFixed(0)}ms (Note: Code download overhead is not included in this measurement)`,
    );
  }
}

const mode = new URL(import.meta.url).searchParams.get("vinext-instrumentation");
if (mode === "start") {
  beginClientInstrumentationTiming();
} else if (mode === "end") {
  endClientInstrumentationTiming();
}
