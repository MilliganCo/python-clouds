import type { ElementType, HTMLAttributes } from "react";

type Props = {
  /** Must already be passed through sanitizeCourseHtml. */
  html: string;
  className?: string;
  /** Legacy often uses <p>; default div. Use span for inline fragments. */
  as?: "div" | "p" | "span";
} & Omit<HTMLAttributes<HTMLElement>, "dangerouslySetInnerHTML" | "children">;

/**
 * Audited renderer for versioned course HTML after allowlist sanitization.
 * Do not pass arbitrary strings — use sanitizeCourseHtml first.
 */
export function TrustedCourseContent({
  html,
  className,
  as = "div",
  ...rest
}: Props) {
  if (!html) return null;
  const Tag = as as ElementType;
  return (
    <Tag
      className={className}
      data-trusted-course-content="1"
      dangerouslySetInnerHTML={{ __html: html }}
      {...rest}
    />
  );
}
