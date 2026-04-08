import type { IncomingHttpHeaders } from "node:http";

const ESCAPE_REGEX = /[&><\u2028\u2029]/;

export function getScriptNonceFromHeader(cspHeaderValue: string): string | undefined {
  const directives = cspHeaderValue.split(";").map((directive) => directive.trim());

  const directive =
    directives.find((value) => value.startsWith("script-src")) ??
    directives.find((value) => value.startsWith("default-src"));

  if (!directive) {
    return undefined;
  }

  const nonce = directive
    .split(" ")
    .slice(1)
    .map((source) => source.trim())
    .find((source) => source.startsWith("'nonce-") && source.length > 8 && source.endsWith("'"))
    ?.slice(7, -1);

  if (!nonce) {
    return undefined;
  }

  if (ESCAPE_REGEX.test(nonce)) {
    throw new Error(
      "Nonce value from Content-Security-Policy contained HTML escape characters.\nLearn more: https://nextjs.org/docs/messages/nonce-contained-invalid-characters",
    );
  }

  return nonce;
}

export function getScriptNonceFromHeaders(headers: Headers | null | undefined): string | undefined {
  const csp =
    headers?.get("content-security-policy") ?? headers?.get("content-security-policy-report-only");

  if (!csp) {
    return undefined;
  }

  return getScriptNonceFromHeader(csp);
}

export function getScriptNonceFromNodeHeaders(
  headers: IncomingHttpHeaders | null | undefined,
): string | undefined {
  if (!headers) {
    return undefined;
  }

  const webHeaders = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        webHeaders.append(key, entry);
      }
      continue;
    }
    if (value !== undefined) {
      webHeaders.set(key, String(value));
    }
  }

  return getScriptNonceFromHeaders(webHeaders);
}

export function getScriptNonceFromHeaderSources(
  ...headersList: readonly (Headers | null | undefined)[]
): string | undefined {
  for (const headers of headersList) {
    const nonce = getScriptNonceFromHeaders(headers);
    if (nonce) {
      return nonce;
    }
  }

  return undefined;
}
