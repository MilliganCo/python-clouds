type Props = {
  source: string;
  className?: string;
};

/**
 * AI / user text only. Foundation: escape as plain text (no HTML/Markdown).
 * Never accepts a raw HTML prop.
 */
export function SafeMarkdown({ source, className }: Props) {
  return <div className={className}>{source}</div>;
}
