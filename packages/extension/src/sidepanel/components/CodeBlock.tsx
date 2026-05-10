import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import type { ReactNode } from 'react';

export function CodeBlock({
  children,
  label,
  copyText,
}: {
  children: ReactNode;
  label?: string;
  copyText?: string;
}) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    if (!copyText) return;
    void navigator.clipboard.writeText(copyText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="rounded-md border border-border bg-muted/40 overflow-hidden text-xs">
      {label || copyText ? (
        <div
          className="flex items-center justify-between px-2 py-1 text-[10px] font-semibold tracking-wide text-muted-foreground bg-secondary border-b border-border"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          <span>{label}</span>
          {copyText ? (
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 hover:text-foreground transition-colors"
              title="Copy to clipboard"
            >
              {copied ? <Check size={10} /> : <Copy size={10} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          ) : null}
        </div>
      ) : null}
      <pre className="p-2 overflow-auto" style={{ fontFamily: 'var(--font-mono)' }}>
        {children}
      </pre>
    </div>
  );
}
