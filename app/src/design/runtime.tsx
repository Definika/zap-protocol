// Helpers used by the converted design markup (see app/tools/convert-template.ts). They reproduce how the design runtime
// rendered its template, so the converted components look and lay out exactly like the design.

import { isValidElement, type CSSProperties, type ReactNode } from 'react';

const cache = new Map<string, CSSProperties>();
const MAX_CACHE = 8_000;

const camel = (p: string) => p.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

function parse(css: string): CSSProperties {
  const out: Record<string, string> = {};
  for (const decl of css.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim();
    if (!prop) continue;
    out[prop.startsWith('--') ? prop : camel(prop)] = decl.slice(i + 1).trim();
  }
  return out as CSSProperties;
}

/** Style from a CSS declaration string ("a:b;c:d") or an object. Custom properties keep their names. */
export function sx(style: string | CSSProperties | null | undefined): CSSProperties | undefined {
  if (style == null) return undefined;
  if (typeof style !== 'string') return style;
  let hit = cache.get(style);
  if (!hit) {
    if (cache.size >= MAX_CACHE) cache.clear();
    hit = parse(style);
    cache.set(style, hit);
  }
  return hit;
}

/**
 * An interpolated value inside text. Elements and arrays render as-is; null, undefined and booleans render nothing;
 * anything else renders as text wrapped in `<span class="sc-interp">` (the wrapper matters inside flex layouts).
 */
export function I(value: unknown): ReactNode {
  if (isValidElement(value) || Array.isArray(value)) return value as ReactNode;
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  return <span className="sc-interp">{String(value)}</span>;
}

/**
 * Template values: the flat object the design markup binds to. Loosely typed on purpose while the converted markup binds to
 * hundreds of keys; each section's view model narrows it as the port progresses.
 */
export type V = Record<string, any>;
