"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

export function InstrumentationClientControls() {
  const router = useRouter();

  return (
    <div>
      <button
        id="clear-nav-events"
        onClick={() => {
          (window as any).__VINEXT_APP_INSTRUMENTATION_NAVS__ = [];
        }}
      >
        Clear
      </button>
      <Link href="/about" id="push-about">
        Push About
      </Link>
      <Link href="#hash-link-target" id="push-hash-link">
        Push Hash Link
      </Link>
      <button
        id="replace-dashboard"
        onClick={() => {
          router.replace("/dashboard");
        }}
      >
        Replace Dashboard
      </button>
      <button
        id="push-hash-router"
        onClick={() => {
          router.push("#hash-router-target");
        }}
      >
        Push Hash Router
      </button>
    </div>
  );
}
