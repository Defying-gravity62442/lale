import type { ReactNode } from 'react';

export function CodeBlock({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/40 overflow-hidden text-xs">
      {label ? (
        <div
          className="px-2 py-1 text-[10px] font-semibold tracking-wide text-muted-foreground bg-secondary border-b border-border"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          {label}
        </div>
      ) : null}
      <pre className="p-2 overflow-auto" style={{ fontFamily: 'var(--font-mono)' }}>
        {children}
      </pre>
    </div>
  );
}
