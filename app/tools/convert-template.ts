// Converts the design template (design/ZAP.html) into React TSX: one component per top-level section plus a Root that
// composes them. The output mirrors the design runtime exactly (conditionals, loops, `{{ }}` bindings, inline styles,
// pseudo-class styles, interpolation spans), so the converted UI renders identically. After conversion the TSX is ours:
// it gets edited by hand as each section is wired to the engine.
//
//   node tools/convert-template.ts           write app/src/design/generated/
//   node tools/convert-template.ts --list    print the sections found

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDocument } from 'htmlparser2';
import type { ChildNode, Element } from 'domhandler';
import { loadBundle, markupOf, ROOT } from './design-bundle.ts';

const OUT = resolve(ROOT, 'app/src/design/generated');
const VALUES = 'vm';

// Section components, keyed by the sc-if condition that wraps them (in order of appearance for repeated conditions).
const SECTION_NAMES: Record<string, string[]> = {
  authGate: ['AuthGate'],
  desktop: ['DesktopHeader', 'DesktopStatusBar'],
  phone: ['PhoneHeader', 'PhoneTabBar'],
  bUninit: ['BannerUninitialized'],
  bRpc: ['BannerRpc'],
  bNosol: ['BannerNoSol'],
  pMarkets: ['MarketsPage'],
  pTrade: ['TradePage'],
  pPortfolio: ['PortfolioPage'],
  pVault: ['VaultPage'],
  menu: ['AccountMenu'],
  walletModal: ['WalletModal'],
  keys: ['ShortcutsModal'],
  mmOpen: ['MarginModeModal'],
  ipOpen: ['IndicatorPicker'],
  ieOpen: ['IndicatorEditor'],
  ccOpen: ['CalculatorModal'],
  eOpen: ['EditPositionModal'],
  cfOpen: ['ConfirmModal'],
};

const ATTR_NAMES: Record<string, string> = {
  class: 'className',
  for: 'htmlFor',
  readonly: 'readOnly',
  maxlength: 'maxLength',
  minlength: 'minLength',
  inputmode: 'inputMode',
  autocomplete: 'autoComplete',
  spellcheck: 'spellCheck',
  tabindex: 'tabIndex',
  autofocus: 'autoFocus',
  crossorigin: 'crossOrigin',
  enterkeyhint: 'enterKeyHint',
  colspan: 'colSpan',
  rowspan: 'rowSpan',
  'xlink:href': 'xlinkHref',
  'xml:space': 'xmlSpace',
};
const BOOLEAN_ATTRS = new Set(['disabled', 'checked', 'readOnly', 'autoFocus', 'multiple', 'required', 'hidden', 'open']);
const NUMBER_ATTRS = new Set(['maxLength', 'minLength', 'tabIndex', 'colSpan', 'rowSpan', 'size', 'rows', 'cols']);
const SKIP_TAGS = new Set(['helmet', 'script', 'style']);

const camel = (s: string) => s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
const WHOLE = /^\s*\{\{([\s\S]+?)\}\}\s*$/;
const PARTS = /\{\{([\s\S]+?)\}\}/g;

type Scope = ReadonlySet<string>;

/** A `{{ }}` binding as a TSX expression. Mirrors the runtime's resolver: paths, `!`, (in)equality, literals. */
function expr(raw: string, scope: Scope): string {
  const e = raw.trim();
  if (e.startsWith('(') && e.endsWith(')')) return `(${expr(e.slice(1, -1), scope)})`;
  const eq = e.match(/^(.+?)\s*(===|!==|==|!=)\s*(.+)$/);
  if (eq) return `(${expr(eq[1]!, scope)} ${eq[2]} ${expr(eq[3]!, scope)})`;
  if (e.startsWith('!')) return `!${expr(e.slice(1), scope)}`;
  if (/^(true|false|null|undefined)$/.test(e) || /^-?\d+(\.\d+)?$/.test(e) || /^'[^']*'$|^"[^"]*"$/.test(e)) return e;
  if (!/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*|\[\d+\])*$/.test(e)) throw new Error(`unsupported binding {{ ${raw} }}`);
  const [head, ...rest] = e.split('.');
  const base = scope.has(head!.replace(/\[.*$/, '')) ? head! : `${VALUES}.${head}`;
  // Like the runtime, a missing intermediate resolves to undefined instead of throwing.
  return rest.length ? `${base}?.${rest.join('?.')}` : base;
}

/** An attribute value: a single binding, a template literal mixing text and bindings, or a static string. */
function value(raw: string, scope: Scope): { code: string; isStatic: boolean } {
  const whole = raw.match(WHOLE);
  if (whole) return { code: expr(whole[1]!, scope), isStatic: false };
  if (raw.includes('{{')) {
    const parts = raw.split(PARTS);
    const tpl = parts
      .map((p, i) => (i % 2 ? `\${${expr(p, scope)} ?? ''}` : p.replace(/[`\\]/g, '\\$&').replace(/\$\{/g, '\\${')))
      .join('');
    return { code: `\`${tpl}\``, isStatic: false };
  }
  return { code: JSON.stringify(raw), isStatic: true };
}

const importantify = (css: string) =>
  css
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => (d.includes('!important') ? d : `${d} !important`))
    .join(';');

class Converter {
  pseudo = new Map<string, string>(); // "hover|css" → class
  counts = new Map<string, number>();

  /**
   * Class for a `style-<pseudo>` attribute. Bindings inside it (the design runtime inserted those verbatim, which made the
   * rule invalid) become CSS variables: the rule reads `var(--<class>-<n>)` and the element sets the variable inline.
   */
  pseudoClass(pseudo: string, css: string, scope: Scope): { cls: string; vars: string[] } {
    const key = `${pseudo}|${css}`;
    let cls = this.pseudo.get(key);
    if (!cls) {
      cls = `zp${this.pseudo.size.toString(36)}`;
      this.pseudo.set(key, cls);
    }
    const vars: string[] = [];
    css.split(PARTS).forEach((p, i) => {
      if (i % 2) vars.push(`'--${cls}-${vars.length}': ${expr(p, scope)}`);
    });
    return { cls, vars };
  }

  attrs(el: Element, scope: Scope): string[] {
    const out: string[] = [];
    const classes: string[] = [];
    const styleVars: string[] = [];
    let style: string | null = null;
    let classExpr: string | null = null;
    for (const [rawName, raw] of Object.entries(el.attribs)) {
      if (rawName.startsWith('hint-') || rawName === 'sc-name' || rawName === 'data-dc-tpl') continue;
      if (rawName.startsWith('style-')) {
        const { cls, vars } = this.pseudoClass(rawName.slice(6), raw, scope);
        classes.push(cls);
        styleVars.push(...vars);
        continue;
      }
      let name = rawName.startsWith('sc-camel-') ? camel(rawName.slice(9)) : (ATTR_NAMES[rawName] ?? rawName);
      if (!rawName.startsWith('sc-camel-') && !name.startsWith('aria-') && !name.startsWith('data-') && name.includes('-')) {
        name = camel(name);
      }
      const v = value(raw, scope);
      if (name === 'style') {
        style = v.code;
      } else if (name === 'className') {
        if (v.isStatic) classes.unshift(raw);
        else classExpr = v.code;
      } else if (BOOLEAN_ATTRS.has(name) && v.isStatic && raw === '') {
        out.push(name);
      } else if (NUMBER_ATTRS.has(name) && v.isStatic && /^-?\d+$/.test(raw)) {
        out.push(`${name}={${raw}}`);
      } else if (name === 'value' && !v.isStatic) {
        out.push(`value={${v.code} ?? ''}`);
      } else if (name === 'checked' && !v.isStatic) {
        out.push(`checked={${v.code} ?? false}`);
      } else if (v.isStatic && !/["\\{}]/.test(raw)) {
        out.push(`${name}="${raw}"`);
      } else {
        out.push(`${name}={${v.code}}`);
      }
    }
    if (styleVars.length) out.push(`style={{ ...sx(${style ?? 'undefined'}), ${styleVars.join(', ')} } as CSSProperties}`);
    else if (style) out.push(`style={sx(${style})}`);
    if (classExpr) out.push(`className={[${classExpr}, ${classes.map((c) => JSON.stringify(c)).join(', ')}].filter(Boolean).join(' ')}`);
    else if (classes.length) out.push(`className="${classes.join(' ')}"`);
    return out;
  }

  text(t: string, scope: Scope): string | null {
    if (!t.includes('{{')) {
      if (!t.trim()) return t.includes(' ') ? `{" "}` : null;
      return /^[^{}<>&]*$/.test(t) && t === t.trim() && !t.includes('\n') ? t : `{${JSON.stringify(t)}}`;
    }
    return t
      .split(PARTS)
      .map((p, i) => (i % 2 ? `{I(${expr(p, scope)})}` : p ? `{${JSON.stringify(p)}}` : ''))
      .join('');
  }

  children(nodes: ChildNode[], scope: Scope, depth: number): string[] {
    const out: string[] = [];
    for (const n of nodes) {
      const s = this.node(n, scope, depth);
      if (s != null) out.push(s);
    }
    return out;
  }

  node(n: ChildNode, scope: Scope, depth: number): string | null {
    const pad = '  '.repeat(depth);
    if (n.type === 'text') {
      const t = this.text(n.data, scope);
      return t == null ? null : pad + t;
    }
    if (n.type !== 'tag' && n.type !== 'script' && n.type !== 'style') return null;
    const el = n as Element;
    if (SKIP_TAGS.has(el.name)) return null;

    if (el.name === 'sc-if') {
      const cond = value(el.attribs['value'] ?? '', scope).code;
      const kids = this.children(el.children, scope, depth + 2);
      if (!kids.length) return null;
      return `${pad}{${cond} ? (\n${pad}  <>\n${kids.join('\n')}\n${pad}  </>\n${pad}) : null}`;
    }
    if (el.name === 'sc-for') {
      const list = value(el.attribs['list'] ?? '', scope).code;
      const as = el.attribs['as'] || 'item';
      const idx = `i${depth}`;
      const inner = new Set(scope);
      inner.add(as);
      inner.add('$index');
      const kids = this.children(el.children, inner, depth + 2);
      return (
        `${pad}{(Array.isArray(${list}) ? ${list} : []).map((${as}: any, ${idx}: number) => {\n` +
        `${pad}  const $index = ${idx};\n` +
        `${pad}  return (\n${pad}    <Fragment key={${idx}}>\n${kids.map((k) => '    ' + k).join('\n')}\n${pad}    </Fragment>\n${pad}  );\n` +
        `${pad}})}`
      );
    }

    const tag = el.name;
    const attrs = this.attrs(el, scope);
    const open = attrs.length ? `<${tag} ${attrs.join(' ')}` : `<${tag}`;
    const kids = this.children(el.children, scope, depth + 1);
    if (!kids.length) return `${pad}${open} />`;
    return `${pad}${open}>\n${kids.join('\n')}\n${pad}</${tag}>`;
  }

  sectionName(el: Element): string | null {
    if (el.name !== 'sc-if') return null;
    const cond = (el.attribs['value'] ?? '').replace(/[{}\s]/g, '');
    const names = SECTION_NAMES[cond];
    if (!names) return null;
    const n = this.counts.get(cond) ?? 0;
    this.counts.set(cond, n + 1);
    return names[n] ?? `${names[names.length - 1]}${n + 1}`;
  }
}

function containsLoop(el: Element, list: string): boolean {
  return el.children.some(
    (c) =>
      c.type === 'tag' &&
      (((c as Element).name === 'sc-for' && new RegExp(`\\{\\{\\s*${list}\\s*\\}\\}`).test((c as Element).attribs['list'] ?? '')) ||
        containsLoop(c as Element, list)),
  );
}

function findSectionParent(nodes: ChildNode[]): Element | null {
  for (const n of nodes) {
    if (n.type !== 'tag') continue;
    const el = n as Element;
    if (el.children.some((c) => c.type === 'tag' && (c as Element).name === 'sc-if' && /\{\{\s*authGate\s*\}\}/.test((c as Element).attribs['value'] ?? ''))) {
      return el;
    }
    const found = findSectionParent(el.children);
    if (found) return found;
  }
  return null;
}

const HEADER = `// GENERATED by app/tools/convert-template.ts from design/ZAP.html, then edited by hand as the port proceeds.\n`;

function main() {
  const listOnly = process.argv.includes('--list');
  const bundle = loadBundle();
  // Static images in the markup point at bundle asset ids (e.g. background:url("<uuid>")); map them to extracted logos.
  const logoPaths = new Map<string, string>();
  for (const [id, uuid] of Object.entries(bundle.resources)) {
    const m = id.match(/^L_logos_(.+)_(png|svg)$/);
    if (m) logoPaths.set(uuid, `/logos/${m[1]}.${m[2]}`);
  }
  const markup = markupOf(bundle.template).replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
    (uuid) => logoPaths.get(uuid) ?? uuid,
  );
  const doc = parseDocument(markup, {
    lowerCaseTags: false,
    lowerCaseAttributeNames: false,
    recognizeSelfClosing: true,
    decodeEntities: true,
  });
  const parent = findSectionParent(doc.children);
  if (!parent) throw new Error('could not find the section parent (the element holding the authGate section)');

  const conv = new Converter();
  const sections: { name: string; node: ChildNode }[] = [];
  let unnamed = 0;
  for (const c of parent.children) {
    if (c.type === 'text' && !c.data.trim()) continue;
    const el = c.type === 'tag' ? (c as Element) : null;
    const name = (el && conv.sectionName(el)) ?? (el && containsLoop(el, 'toasts') ? 'Toasts' : `Section${++unnamed}`);
    sections.push({ name, node: c });
  }

  if (listOnly) {
    for (const s of sections) {
      const el = s.node.type === 'tag' ? (s.node as Element) : null;
      console.log(s.name.padEnd(24), el ? `<${el.name} ${Object.entries(el.attribs).map(([k, v]) => `${k}="${v.slice(0, 50)}"`).join(' ').slice(0, 110)}>` : s.node.type);
    }
    return;
  }

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const empty = new Set<string>();
  for (const s of sections) {
    const body = conv.node(s.node, empty, 3);
    if (!body) continue;
    const usesFragment = body.includes('<Fragment');
    const usesI = body.includes('{I(');
    const usesCss = body.includes('as CSSProperties');
    const reactNames = [usesFragment ? 'Fragment' : '', usesCss ? 'type CSSProperties' : ''].filter(Boolean);
    const imports = [
      reactNames.length ? `import { ${reactNames.join(', ')} } from 'react';\n` : '',
      `import { ${['sx', usesI ? 'I' : '', 'type V'].filter(Boolean).join(', ')} } from '../runtime';\n`,
    ].join('');
    writeFileSync(
      resolve(OUT, `${s.name}.tsx`),
      `${HEADER}${imports}\nexport function ${s.name}({ ${VALUES} }: { ${VALUES}: V }) {\n  return (\n    <>\n${body}\n    </>\n  );\n}\n`,
    );
  }

  // Root: everything above the sections, with each section replaced by its component.
  const sectionNodes = new Map(sections.map((s) => [s.node, s.name]));
  const rootConv = new Converter();
  rootConv.pseudo = conv.pseudo;
  const origNode = rootConv.node.bind(rootConv);
  rootConv.node = (n, scope, depth) => {
    const name = sectionNodes.get(n);
    return name ? `${'  '.repeat(depth)}<${name} ${VALUES}={${VALUES}} />` : origNode(n, scope, depth);
  };
  const rootBody = rootConv.children(doc.children, empty, 3).join('\n');
  const names = sections.map((s) => s.name);
  writeFileSync(
    resolve(OUT, 'Root.tsx'),
    `${HEADER}import { sx, type V } from '../runtime';\n` +
      names.map((n) => `import { ${n} } from './${n}';\n`).join('') +
      `\nexport function Root({ ${VALUES} }: { ${VALUES}: V }) {\n  return (\n    <>\n${rootBody}\n    </>\n  );\n}\n`,
  );

  const rules = [...conv.pseudo.entries()].map(([key, cls]) => {
    const [pseudo, raw] = key.split(/\|(.*)/s) as [string, string];
    let n = 0;
    const css = raw.replace(PARTS, () => `var(--${cls}-${n++})`);
    const sep = pseudo === 'before' || pseudo === 'after' ? '::' : ':';
    return `.${cls}${sep}${pseudo}{${sep === '::' ? css : importantify(css)}}`;
  });
  writeFileSync(resolve(OUT, 'pseudo.css'), `/* GENERATED by app/tools/convert-template.ts: style-hover / style-active from the design */\n${rules.join('\n')}\n`);

  console.log(`sections: ${names.length} (${names.join(', ')}) · pseudo classes: ${rules.length}`);
}

main();
