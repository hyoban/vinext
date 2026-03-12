"use client";

import { useSelectedLayoutSegment, useSelectedLayoutSegments } from "next/navigation";

export function SegmentShellDisplay() {
  const segments = useSelectedLayoutSegments();
  const segment = useSelectedLayoutSegment();

  return (
    <div data-testid="route-group-layout-segment-display">
      <span data-testid="route-group-layout-segments">{JSON.stringify(segments)}</span>
      <span data-testid="route-group-layout-segment">{segment ?? "null"}</span>
    </div>
  );
}
