import { useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

// Extract content inside outermost balanced braces at src[pos] (must be '{').
function extractBraced(src: string, pos: number): { inner: string; end: number } | null {
  if (src[pos] !== '{') return null;
  let depth = 0;
  for (let i = pos; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      if (--depth === 0) return { inner: src.slice(pos + 1, i), end: i + 1 };
    }
  }
  return null;
}

// Convert text-mode LaTeX to safe HTML (math segments already removed).
function textToHtml(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '<') { out += '&lt;'; i++; continue; }
    if (ch === '>') { out += '&gt;'; i++; continue; }
    if (ch === '&') { out += '&amp;'; i++; continue; }
    if (ch === '~') { out += ' '; i++; continue; }
    if (ch !== '\\') { out += ch; i++; continue; }

    i++;
    if (i >= src.length) break;

    // Non-alpha escape sequences.
    if (src[i] === '\\') { out += ' '; i++; continue; }
    if (src[i] === ' ' || src[i] === ',' || src[i] === ';' || src[i] === '!') { i++; continue; }
    if (src[i] === '%') { out += '%'; i++; continue; }

    // Read alphabetic command name.
    let j = i;
    while (j < src.length && /[a-zA-Z]/.test(src[j] ?? '')) j++;
    const cmd = src.slice(i, j);
    i = j;
    while (i < src.length && src[i] === ' ') i++; // skip trailing space

    if (src[i] === '{') {
      const b = extractBraced(src, i);
      if (b) {
        i = b.end;
        const inner = textToHtml(b.inner);
        switch (cmd) {
          case 'emph': case 'textit': case 'it':
            out += `<em>${inner}</em>`; break;
          case 'textbf': case 'bf':
            out += `<strong>${inner}</strong>`; break;
          case 'text': case 'textrm': case 'textsf': case 'texttt': case 'mbox':
            out += inner; break;
          case 'label': case 'footnote': case 'index': case 'vspace': case 'hspace':
            break; // strip
          case 'cite': case 'citet': case 'citep': case 'citealt':
            out += '<span style="opacity:0.55">[cite]</span>'; break;
          case 'ref': case 'eqref': case 'cref': case 'Cref': case 'autoref':
            out += `<span style="opacity:0.55">[${inner}]</span>`; break;
          default:
            out += inner; // unknown command — show its content
        }
        continue;
      }
    }

    // Bare commands.
    switch (cmd) {
      case 'noindent': case 'medskip': case 'bigskip': case 'smallskip':
      case 'newline': case 'par':
        out += ' '; break;
      case 'ie': out += 'i.e.'; break;
      case 'eg': out += 'e.g.'; break;
      // everything else: skip silently
    }
  }
  return out;
}

type Seg = { type: 'text'; src: string } | { type: 'math'; src: string; display: boolean };

function segmentize(latex: string): Seg[] {
  const segs: Seg[] = [];
  // $$...$$ and \[...\] must come before $...$ to avoid partial matches.
  const re = /(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\$[^$\n]+?\$|\\\([\s\S]*?\\\))/g;
  let last = 0;
  for (const m of latex.matchAll(re)) {
    if (m.index! > last) segs.push({ type: 'text', src: latex.slice(last, m.index) });
    const raw = m[0];
    let expr: string, display: boolean;
    if (raw.startsWith('$$'))      { expr = raw.slice(2, -2);  display = true; }
    else if (raw.startsWith('\\[')) { expr = raw.slice(2, -2);  display = true; }
    else if (raw.startsWith('$'))  { expr = raw.slice(1, -1);  display = false; }
    else                           { expr = raw.slice(2, -2);  display = false; }
    segs.push({ type: 'math', src: expr, display });
    last = m.index! + raw.length;
  }
  if (last < latex.length) segs.push({ type: 'text', src: latex.slice(last) });
  return segs;
}

function renderToHtml(latex: string): string {
  return segmentize(latex).map((seg) => {
    if (seg.type === 'text') return textToHtml(seg.src);
    try {
      return katex.renderToString(seg.src.trim(), {
        throwOnError: false,
        displayMode: seg.display,
        output: 'html',
      });
    } catch {
      return `<span>${seg.src}</span>`;
    }
  }).join('');
}

interface Props {
  latex: string;
  className?: string;
}

export function LatexPreview({ latex, className }: Props) {
  // Safe: KaTeX output is trusted; text is HTML-escaped in textToHtml.
  const html = useMemo(() => renderToHtml(latex), [latex]);
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
