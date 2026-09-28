// Reads the bundled design export (design/ZAP.html): a manifest of base64 assets, a list of named resources,
// and the page template. Shared by extract-design.ts and convert-template.ts.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const DESIGN_FILE = resolve(ROOT, 'design/ZAP.html');

type ManifestEntry = { mime: string; compressed: boolean; data: string };

export type DesignBundle = {
  /** Page template: `<x-dc>` markup plus the logic `<script type="text/x-dc">`. */
  template: string;
  /** Named resources (`keelData`, `L_logos_btc_png`, …) → asset uuid. */
  resources: Record<string, string>;
  asset(uuid: string): { mime: string; bytes: Buffer };
};

function scriptBlock(html: string, type: string): string {
  const m = html.match(new RegExp(`<script type="__bundler/${type}">([\\s\\S]*?)</script>`));
  if (!m?.[1]) throw new Error(`design bundle: missing ${type} block`);
  return m[1];
}

export function loadBundle(file = DESIGN_FILE): DesignBundle {
  const html = readFileSync(file, 'utf8');
  const manifest = JSON.parse(scriptBlock(html, 'manifest')) as Record<string, ManifestEntry>;
  const ext = JSON.parse(scriptBlock(html, 'ext_resources')) as { id: string; uuid: string }[];
  const template = JSON.parse(scriptBlock(html, 'template')) as string;
  return {
    template,
    resources: Object.fromEntries(ext.map((e) => [e.id, e.uuid])),
    asset(uuid) {
      const e = manifest[uuid];
      if (!e) throw new Error(`design bundle: no asset ${uuid}`);
      const raw = Buffer.from(e.data, 'base64');
      return { mime: e.mime, bytes: e.compressed ? gunzipSync(raw) : raw };
    },
  };
}

/** The `<x-dc>` markup without the logic script. */
export function markupOf(template: string): string {
  const start = template.indexOf('<x-dc>');
  const end = template.lastIndexOf('</x-dc>');
  if (start < 0 || end < 0) throw new Error('design bundle: no <x-dc> root');
  return template.slice(start + '<x-dc>'.length, end);
}

/** Source of the `class Component extends DCLogic` script. */
export function logicOf(template: string): string {
  const m = template.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/);
  if (!m?.[1]) throw new Error('design bundle: no logic script');
  return m[1];
}
