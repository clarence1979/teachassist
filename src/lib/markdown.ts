import { marked, type Tokens } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';
import katex from 'katex';

// ─── KaTeX extensions for marked ──────────────────────────────────────────────

const inlineMath = {
  name: 'inlineMath',
  level: 'inline' as const,
  start(src: string) { return src.indexOf('$'); },
  tokenizer(src: string) {
    const match = /^\$([^$\n]+?)\$/.exec(src);
    if (match) {
      return {
        type: 'inlineMath',
        raw: match[0],
        text: match[1].trim(),
      };
    }
    return undefined;
  },
  renderer(token: Tokens.Generic) {
    try {
      return katex.renderToString(token.text as string, { throwOnError: false, displayMode: false });
    } catch {
      return `<code>${token.text}</code>`;
    }
  },
};

const blockMath = {
  name: 'blockMath',
  level: 'block' as const,
  start(src: string) { return src.indexOf('$$'); },
  tokenizer(src: string) {
    const match = /^\$\$([\s\S]+?)\$\$/.exec(src);
    if (match) {
      return {
        type: 'blockMath',
        raw: match[0],
        text: match[1].trim(),
      };
    }
    return undefined;
  },
  renderer(token: Tokens.Generic) {
    try {
      return `<div class="math-block">${katex.renderToString(token.text as string, { throwOnError: false, displayMode: true })}</div>`;
    } catch {
      return `<pre><code>${token.text}</code></pre>`;
    }
  },
};

// ─── Configure marked ─────────────────────────────────────────────────────────

marked.use({
  gfm: true,
  breaks: true,
  extensions: [blockMath, inlineMath],
  renderer: {
    code(this: unknown, code: Tokens.Code) {
      const lang = code.lang?.trim();
      let highlighted = '';
      if (lang && hljs.getLanguage(lang)) {
        try {
          highlighted = hljs.highlight(code.text, { language: lang, ignoreIllegals: true }).value;
        } catch {
          highlighted = escapeHtml(code.text);
        }
      } else {
        highlighted = hljs.highlightAuto(code.text).value;
      }
      const langLabel = lang ? `<div class="code-lang">${lang}</div>` : '';
      return `<div class="code-block">${langLabel}<pre><code class="hljs language-${lang ?? 'plaintext'}">${highlighted}</code></pre></div>`;
    },
  },
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function renderMarkdown(source: string): string {
  const raw = marked.parse(source, { async: false }) as string;
  return DOMPurify.sanitize(raw, {
    ADD_TAGS: ['math', 'semantics', 'mrow', 'mi', 'mn', 'mo', 'ms', 'mtext', 'annotation', 'svg', 'path'],
    ADD_ATTR: ['class', 'style', 'xmlns', 'd', 'viewBox', 'fill', 'stroke'],
  });
}
