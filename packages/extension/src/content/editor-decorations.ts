/**
 * Editor decorations: render a small colored dot in the gutter on each claim's start line.
 *
 * Overleaf's CodeMirror 6 view is reachable via the DOM. The internal property names are NOT
 * stable — if Overleaf changes anything we degrade gracefully (no decorations, paste-LaTeX
 * fallback in the side panel). See .claude/agents/extension-mv3.md for the hazard list.
 */

import type { ClaimStatus } from '@lale/shared';

const STATUS_COLOR: Record<ClaimStatus, string> = {
  verified: '#10b981',
  failed: '#ef4444',
  sorry: '#f59e0b',
  verifying: '#3b82f6',
  translating: '#8b5cf6',
  unverified: '#9ca3af',
};

interface Decoration {
  claimId: string;
  label?: string;
  line: number;
  status: ClaimStatus;
  el?: HTMLElement;
}

let decorations: Decoration[] = [];

function getCmContent(): HTMLElement | null {
  // Overleaf's CodeMirror 6 root.
  return document.querySelector('.cm-editor .cm-content');
}

function ensureLayer(): HTMLElement | null {
  const editor = document.querySelector('.cm-editor');
  if (!editor) return null;
  let layer = editor.querySelector<HTMLElement>('[data-lale-layer]');
  if (!layer) {
    layer = document.createElement('div');
    layer.dataset.laleLayer = 'true';
    layer.style.position = 'absolute';
    layer.style.top = '0';
    layer.style.left = '0';
    layer.style.pointerEvents = 'none';
    layer.style.zIndex = '5';
    (editor as HTMLElement).style.position = 'relative';
    editor.appendChild(layer);
  }
  return layer;
}

function lineYOffset(lineIndex: number): number | null {
  // CM6 wraps each visible line in a div; we count rendered .cm-line elements within content.
  const content = getCmContent();
  if (!content) return null;
  const lineEls = content.querySelectorAll<HTMLElement>('.cm-line');
  const el = lineEls[lineIndex];
  if (!el) return null;
  const editor = document.querySelector<HTMLElement>('.cm-editor');
  if (!editor) return null;
  const eRect = editor.getBoundingClientRect();
  const lRect = el.getBoundingClientRect();
  return lRect.top - eRect.top + 4;
}

function renderOne(d: Decoration): void {
  const layer = ensureLayer();
  if (!layer) return;
  const y = lineYOffset(d.line);
  if (y == null) {
    if (d.el) d.el.remove();
    d.el = undefined;
    return;
  }
  if (!d.el) {
    d.el = document.createElement('div');
    d.el.style.position = 'absolute';
    d.el.style.left = '1px';
    d.el.style.width = '10px';
    d.el.style.height = '10px';
    d.el.style.borderRadius = '50%';
    d.el.style.transition = 'background-color 0.18s ease';
    d.el.style.cursor = 'default';
    layer.appendChild(d.el);
  }
  d.el.style.top = `${y}px`;
  d.el.style.backgroundColor = STATUS_COLOR[d.status];
  d.el.title = `${d.label ?? d.claimId} — ${d.status}`;
}

function renderAll(): void {
  for (const d of decorations) renderOne(d);
}

export function setDecorations(items: { claimId: string; label?: string; line: number; status: ClaimStatus }[]): void {
  // Replace the set; keep elements when possible to avoid flicker.
  const next: Decoration[] = items.map((i) => {
    const existing = decorations.find((d) => d.claimId === i.claimId);
    return existing
      ? { ...existing, label: i.label, line: i.line, status: i.status }
      : { claimId: i.claimId, label: i.label, line: i.line, status: i.status };
  });
  // Remove dropped elements.
  for (const d of decorations) {
    if (!next.find((n) => n.claimId === d.claimId)) {
      d.el?.remove();
    }
  }
  decorations = next;
  renderAll();
}

export function setClaimStatus(claimId: string, status: ClaimStatus): void {
  const d = decorations.find((x) => x.claimId === claimId);
  if (!d) return;
  d.status = status;
  renderOne(d);
}

// Reposition on scroll/resize.
let raf = 0;
function scheduleRender(): void {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    renderAll();
  });
}

window.addEventListener('scroll', scheduleRender, true);
window.addEventListener('resize', scheduleRender);

const ro = new ResizeObserver(() => scheduleRender());
const editorEl = document.querySelector('.cm-editor');
if (editorEl) ro.observe(editorEl);
