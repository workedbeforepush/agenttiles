// Markdown for the hover details (kept DOM-free so it is testable in Node).

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Small Markdown subset as HTML for the hover details: code blocks, inline code, bold, italic, headings, bullets.
 * The text is escaped first, so only the tags added here reach the page. Links keep their text only.
 */
export function markdownHtml(markdown: string): string {
  const parts = escapeHtml(markdown).split(/```[^\n]*\n?/);
  return parts
    .map((part, i) => (i % 2 === 1 ? `<pre>${part.replace(/\n$/, '')}</pre>` : inlineMarkdown(part)))
    .join('');
}

function inlineMarkdown(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+(.*)$/, '<strong>$1</strong>')
        .replace(/^(\s*)[-*+]\s+/, '$1• ')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*(.+?)\*\*|__(.+?)__/g, '<strong>$1$2</strong>')
        .replace(/(^|[^*\w])\*(?![\s*])([^*]+?)\*(?![*\w])/g, '$1<em>$2</em>')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        // markers left open by clipping
        .replace(/\*\*(?=\w)|`/g, ''),
    )
    .join('\n');
}
