import { SegmentShellDisplay } from "./segment-shell-display";

export default function ShellSegmentLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-testid="route-group-layout-shell">
      <SegmentShellDisplay />
      {children}
    </div>
  );
}
