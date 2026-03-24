import { InstrumentationClientControls } from "./controls";

export default function InstrumentationClientTestPage() {
  return (
    <main>
      <h1 id="instrumentation-client-test">Instrumentation Client Test</h1>
      <InstrumentationClientControls />
      <div id="hash-link-target">Hash Link Target</div>
      <div id="hash-router-target">Hash Router Target</div>
    </main>
  );
}
