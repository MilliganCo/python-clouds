const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "code",
  "pre",
  "ul",
  "ol",
  "li",
  "strong",
  "b",
  "em",
  "a",
  "span",
  "h1",
  "h2",
  "h3",
  "h4",
]);

function isSafeHref(href: string): boolean {
  const value = href.trim();
  if (!value) return false;
  if (value.startsWith("#")) return true;
  try {
    const url = new URL(value, "https://example.invalid");
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Allowlist sanitizer for versioned repository course HTML.
 * Not for AI/user text — use SafeMarkdown instead.
 */
export function sanitizeCourseHtml(html: string): string {
  if (typeof document === "undefined") {
    // SSR/test without DOM: strip tags aggressively
    return html.replace(/<[^>]*>/g, "");
  }
  const template = document.createElement("template");
  template.innerHTML = html;
  const walk = (node: Node): void => {
    const children = [...node.childNodes];
    for (const child of children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement;
        const tag = el.tagName.toLowerCase();
        if (!ALLOWED_TAGS.has(tag)) {
          el.replaceWith(...el.childNodes);
          walk(node);
          return;
        }
        for (const attr of [...el.attributes]) {
          const name = attr.name.toLowerCase();
          if (tag === "a" && name === "href" && isSafeHref(attr.value)) {
            el.setAttribute("rel", "noopener noreferrer");
            continue;
          }
          el.removeAttribute(attr.name);
        }
        walk(el);
      } else if (child.nodeType === Node.COMMENT_NODE) {
        child.parentNode?.removeChild(child);
      }
    }
  };
  walk(template.content);
  return template.innerHTML;
}
