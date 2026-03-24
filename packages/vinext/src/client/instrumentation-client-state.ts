import type { ClientInstrumentationHooks } from "./instrumentation-client.js";

let clientInstrumentationHooks: ClientInstrumentationHooks | null = null;

export function setClientInstrumentationHooks(
  hooks: ClientInstrumentationHooks | null,
): ClientInstrumentationHooks | null {
  clientInstrumentationHooks = hooks;
  return clientInstrumentationHooks;
}

export function getClientInstrumentationHooks(): ClientInstrumentationHooks | null {
  return clientInstrumentationHooks;
}
