// @ts-nocheck
// The terminal's view logic: the design prototype's logic class, wired to ZAP. Its mock engine (local fills, simulated
// orders and balances, seeded data) is replaced by real transactions (actions.ts) and the live account (map.ts), and
// features the engine doesn't back are gone. Chart drawing, indicators and layout are the design's own code.

import * as React from 'react';
import * as K from './keel';
import * as Act from './actions';
import { DCLogic } from './dclogic';
import { fromAccount, toHistory } from './map';
import { store } from '../engine/store';

const cap = s => s ? s[0].toUpperCase() + s.slice(1) : '';
const THEMES = {
  dark: { '--bg': '#07090E', '--hd': '#0A0D14', '--p': '#0E121A', '--r': '#141925', '--in': '#0B0F16', '--h': '#1A2030', '--l': '#171D29', '--l2': '#262E3D', '--t': '#E7EAF2', '--t2': '#A0A8BA', '--t3': '#7A8397', '--g': '#2FD08F', '--gt': 'rgba(47,208,143,.13)', '--rd': '#FF5C63', '--rt': 'rgba(255,92,99,.13)', '--am': '#F4B740', '--amt': 'rgba(244,183,64,.13)', '--ov': 'rgba(3,5,9,.72)', '--sh': '0 18px 48px rgba(0,0,0,.55)', '--sk': '#161B26', '--gf': '#2FD08F', '--gi': '#03150D', '--rf': '#FF5C63', '--ri': '#1C0406', '--grid': 'rgba(255,255,255,.045)', '--wm': 'rgba(231,234,242,.035)', '--c1': '#F472B6' },
  light: { '--bg': '#ECEEF2', '--hd': '#FFFFFF', '--p': '#FFFFFF', '--r': '#F2F4F7', '--in': '#F7F8FA', '--h': '#EEF0F4', '--l': '#E6E9EE', '--l2': '#D2D7DF', '--t': '#0F1320', '--t2': '#475067', '--t3': '#646E84', '--g': '#08875B', '--gt': 'rgba(8,135,91,.10)', '--rd': '#D42F39', '--rt': 'rgba(212,47,57,.09)', '--am': '#95590A', '--amt': 'rgba(222,150,20,.14)', '--ov': 'rgba(15,19,32,.38)', '--sh': '0 18px 48px rgba(15,19,32,.16)', '--sk': '#E8EBF0', '--gf': '#27C986', '--gi': '#03150D', '--rf': '#FF5C63', '--ri': '#1C0406', '--grid': 'rgba(15,19,32,.06)', '--wm': 'rgba(15,19,32,.04)', '--c1': '#BE2F7A' },
};
const ACCENTS = {
  '#7B5CFA': { dark: ['#A98FFF', '#7B5CFA', '#FFFFFF', 'rgba(142,107,255,.16)'], light: ['#5B3BE8', '#6A4AF5', '#FFFFFF', 'rgba(106,74,245,.10)'] },
  '#2F6BFF': { dark: ['#7FB0FF', '#2F6BFF', '#FFFFFF', 'rgba(79,140,255,.16)'], light: ['#1D55D6', '#2F6BFF', '#FFFFFF', 'rgba(47,107,255,.10)'] },
  '#12B5C9': { dark: ['#5ED6E8', '#3CC8DA', '#041418', 'rgba(60,200,218,.15)'], light: ['#0A6F7C', '#0B7F8E', '#FFFFFF', 'rgba(14,140,156,.10)'] },
};
const DENS = { compact: { '--rh': '40px', '--tr': '21px', '--gp': '4px', '--pp': '12px' }, comfortable: { '--rh': '50px', '--tr': '25px', '--gp': '8px', '--pp': '16px' } };
const DI = { ray: 'M5 19L20 4M3.5 17.5h3v3h-3z', ext: 'M3 21L21 3M9.5 13h3v3h-3zM12.5 8h3v3h-3z', vline: 'M12 3v18M9 7h6', arrow: 'M5 19L19 5M11 5h8v8', channel: 'M3 14L14 3M10 21L21 10', fibext: 'M4 5h16M4 10h10M4 15h16M4 20h7', pitch: 'M3 12h6M9 12l11-7M9 12l11 7M9 12h11', circle: 'M4 12a8 6.5 0 1 0 16 0a8 6.5 0 1 0-16 0', brush: 'M4 18c2.5 0 3-3 5.5-3s3 3 5.5 1s3-7 5-9', prange: 'M12 5v14M9 8l3-3 3 3M9 16l3 3 3-3M5 3h14M5 21h14', drange: 'M5 12h14M8 9l-3 3 3 3M16 9l3 3-3 3M3 5v14M21 5v14', long: 'M4 13h16v7H4zM4 4h16v9M12 11V6M9.5 8.5L12 6l2.5 2.5', short: 'M4 4h16v7H4zM4 11h16v9M12 13v5M9.5 15.5L12 18l2.5-2.5', text: 'M5 7V4h14v3M12 4v16M9 20h6', lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3', unlock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 6.8-1.2', cursor: 'M12 4v5M12 15v5M4 12h5M15 12h5', trend: 'M6 18L18 6M3.5 16.5h3v3h-3zM17.5 4.5h3v3h-3z', hline: 'M3 12h18M6 9v6', rect: 'M5 7h14v10H5z', fib: 'M4 5h16M4 9.5h12M4 14h8M4 19h16', measure: 'M12 4v16M8.5 7.5L12 4l3.5 3.5M8.5 16.5L12 20l3.5-3.5', magnet: 'M6 4v8a6 6 0 0 0 12 0V4M6 8h3.5M14.5 8H18', eye: 'M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12zM12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5', eyeOff: 'M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12zM4 4l16 16', undo: 'M9 7L5 11l4 4M5 11h9a5 5 0 0 1 0 10h-2', trash: 'M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12' };
const CTL = { candles: 'Candles', hollow: 'Hollow', bars: 'Bars', line: 'Line', area: 'Area' };
const WL = { Phantom: '/logos/phantom.svg', Backpack: '/logos/backpack.png', Solflare: '/logos/solflare_icon.svg' };
/** Trades the keeper makes for a trader: liquidations, position TP/SL and order fills. */
const KEEPER = [2, 3, 4, 5, 6];
const loadAlerts = () => { try { return JSON.parse(localStorage.getItem('zap-alerts') || '[]'); } catch (e) { return []; } };
const TABS_D = { markets: 'M4 6h16M4 12h16M4 18h10', trade: 'M7 3v4M7 17v4M5 7h4v10H5zM17 4v3M17 15v5M15 7h4v8h-4z', portfolio: 'M21 12a9 9 0 1 1-9-9v9z', vault: 'M4 5h16v14H4zM12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5', leaderboard: 'M18 20V10M12 20V4M6 20v-6' };

export class TerminalLogic extends DCLogic {
  K = K;
  state = { page: 'trade', market: 'SOL-USD', menu: false, auStep: 'main', auEmail: '', auCode: '', auBusy: '', auErr: '', auResendAt: 0, keys: false, usdc: 0, positions: [], orders: [], history: [], funding: [], shares: 0, vdep: 0, tf: '15m', mode: 'candles', pyth: false, ref: true, hx: null, hy: 0, lev: 20, margin: '250', tpsl: false, tp: '', sl: '', slip: 1, confirmOn: true, unit: 'usd', settings: false, switcher: false, swq: '', confirm: null, dontAsk: false, side: 'long', preSide: '', tab: 'positions', ptab: 'positions', q: '', cat: 'All', sort: 'rank', dir: 1, otype: 'market', px: '', edit: null, feesOpen: false, tpMulti: false, tpQ1: '50', tpL: [], ctx: null, caArm: false, tif: 'gtc', ro: false, alerts: loadAlerts(), inMode: 'margin', sizeIn: '', calc: null, alOpen: false, alPx: '', lineDrag: null, lineHold: null, dpHov: null, vtab: 'deposit', vamt: '', toasts: [], w: 1440, bpH: 270, trW: 240, ofW: 320, prange: '30D', vrange: '30D', lbWin: '7d', lbMetric: 'pnl', tool: 'cursor', magnet: false, hideDraw: false, drawings: {}, draft: null, measure: null, ctype: 'candles', ind: {}, inds: null, indFav: ['ma', 'ema', 'bb', 'rsi', 'macd'], indPick: false, indQ: '', indCat: 'All', indEdit: null, view: { count: 96, end: null }, menu2: null, menuX: 0, chartFull: false, panning: false };
  rootRef = el => { this.root = el; if (!el) return; if (this.ro) this.ro.observe(el); const w0 = Math.round(el.getBoundingClientRect().width); if (w0 && w0 !== this.state.w) this.setState({ w: w0 }); };
  searchRef = el => { this.searchEl = el; };
  plotRef = el => { if (this.pro) this.pro.disconnect(); if (this.plotEl) this.plotEl.removeEventListener('wheel', this.wheel); this.plotEl = el; if (!el) return; el.addEventListener('wheel', this.wheel, { passive: false }); if (el.getBoundingClientRect().height < 230 && this.state.indFold == null) this.setState({ indFold: true }); const h0 = Math.round(el.getBoundingClientRect().height), w0 = Math.round(el.getBoundingClientRect().width); if ((h0 && h0 !== this.state.plotH) || (w0 && w0 !== this.state.plotW)) this.setState({ plotH: h0, plotW: w0 }); this.pro = new ResizeObserver(es => { const h = Math.round(es[0].contentRect.height), w2 = Math.round(es[0].contentRect.width); if (w2 && w2 !== this.state.plotW) this.setState({ plotW: w2 }); if (h && h !== this.state.plotH) this.setState({ plotH: h }); }); this.pro.observe(el); };
  stop = e => e.stopPropagation();
  lnRef = el => { this.lnEl = el; };
  stopPd = e => { e.stopPropagation(); };
  chartRef = el => { this.chartEl = el; };
  wheel = e => { const C = this.cur && this.cur.C; if (!C) return; e.preventDefault(); const k = e.deltaY > 0 ? 1.12 : 1 / 1.12; this.setState(st => ({ view: { count: Math.max(20, Math.min(C.N, Math.round(st.view.count * k))), end: st.view.end } })); };
  ptFromEvt(e) { const el = this.plotEl, cur = this.cur; if (!el || !cur) return null; const r = el.getBoundingClientRect(), C = cur.C, hx = (e.clientX - r.left) / r.width, hy = (e.clientY - r.top - 28) / Math.max(1, r.height - 44), fi = C.start + hx * C.slots - .5; let t = C.t0 + fi * cur.TFms, p = C.hi - hy * (C.hi - C.lo); if (this.state.magnet) { const c = C.all[Math.max(0, Math.min(C.N - 1, Math.round(fi)))]; t = c.t; p = [c.o, c.h, c.l, c.c].reduce((b, v) => Math.abs(v - p) < Math.abs(b - p) ? v : b, c.c); } return { t: t, p: p }; }
  hitDraw(e) {
    const el = this.plotEl, cur = this.cur, s = this.state; if (!el || !cur || s.hideDraw || s.drawLock) return null;
    const list = s.drawings[s.market] || []; if (!list.length) return null;
    const r = el.getBoundingClientRect(), C = cur.C, W = r.width, H = Math.max(1, r.height - 44), px = e.clientX - r.left, py = e.clientY - r.top - 28;
    const X = t => ((((t - C.t0) / cur.TFms) - C.start + .5) / C.slots) * W, Y = p => (C.hi - p) / (C.hi - C.lo) * H, id = v => String(v);
    const seg = (x1, y1, x2, y2) => { const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy, k = L ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / L)) : 0; return Math.hypot(px - (x1 + k * dx), py - (y1 + k * dy)); };
    const G = list.map((d, i) => this.drawGeom(d, X, Y, W, H, id, id, false));
    const order = s.selDraw != null && list[s.selDraw] ? [s.selDraw].concat(list.map((_, i) => i).filter(i => i !== s.selDraw)) : list.map((_, i) => i).reverse();
    for (const i of order) for (const h of G[i].handles) if (Math.hypot(px - h.x, py - h.y) <= 8) return { i, k: h.k };
    let best = null, bd = 7;
    list.forEach((d, i) => { const g = G[i]; g.segs.forEach(q => { const v = seg(...q); if (v <= bd) { bd = v; best = { i, k: 'body' }; } }); if (!best || best.i !== i) g.areas.forEach(q => { if (px >= q[0] - 3 && px <= q[2] + 3 && py >= q[1] - 3 && py <= q[3] + 3 && bd > 3) { bd = 3; best = { i, k: 'body' }; } }); });
    return best;
  }
  delDrawing(i) { this.setState(st => { const cur = (st.drawings[st.market] || []).slice(); cur.splice(i, 1); return { selDraw: null, drawings: Object.assign({}, st.drawings, { [st.market]: cur }) }; }); }
  addDrawing(d) { this.setState(st => { const cur = st.drawings[st.market] || [], nd = { type: d.type, a: d.a, b: d.b, c: d.c, pts: d.pts, s: d.s, text: d.text, st: { ...(st.drawStyle || {}) } }; return { draft: null, tool: 'cursor', selDraw: cur.length, drawings: Object.assign({}, st.drawings, { [st.market]: cur.concat([nd]) }) }; }); }
  indMk(t, p) { const D = this.K.IND[t]; return { id: t + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), t, p: Object.assign(Object.fromEntries(D.params.map(q => [q[0], q[2]])), p || {}), c: D.colors.slice(), w: D.lines.map(() => t === 'sar' ? 3 : 1.3), hidden: false, h: 96 }; }
  indList() { const s = this.state; if (s.inds) return s.inds; if (!this.K) return []; return this._indDef || (this._indDef = []); }
  indSet(fn) { this.setState(st => ({ inds: fn((st.inds || this.indList()).slice()) })); }
  indPatch(id, patch) { this.indSet(l => l.map(q => q.id === id ? { ...q, ...(typeof patch === 'function' ? patch(q) : patch) } : q)); }
  indRemove(id) { this.indSet(l => l.filter(q => q.id !== id)); if (this.state.indEdit === id) this.setState({ indEdit: null }); }
  indAdd(t) { const q = this.indMk(t), used = this.indList().filter(x => x.t === t).length; if (used && this.K.IND[t].colors[0]) q.c = q.c.map((c, i) => this.K.IND_COLORS[(this.K.IND_COLORS.indexOf(c) + used * 2 + i) % 8]); this.indSet(l => l.concat([q])); }
  paneDown(e, q) { if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); const sy = e.clientY, h0 = q.h || 96; let raf = 0, h = h0; const mv = ev => { h = Math.max(48, Math.min(320, h0 - (ev.clientY - sy))); if (!raf) raf = requestAnimationFrame(() => { raf = 0; this.indPatch(q.id, { h }); }); }; const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); }; window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); }
  toggleInd(k) { this.setState(st => ({ ind: Object.assign({}, st.ind, { [k]: !st.ind[k] }) })); }
  openMenu(which, e) { const r = e.currentTarget.getBoundingClientRect(), cr = this.chartEl ? this.chartEl.getBoundingClientRect() : { left: 0 }; this.setState(st => ({ menu2: st.menu2 === which ? null : which, menuX: Math.max(4, Math.round(r.left - cr.left)) })); }
  chartDown(e) {
    if (e.button !== 0 || !this.cur) return; e.preventDefault();
    const s = this.state, C = this.cur.C;
    if (s.ctx) this.setState({ ctx: null });
    if (s.railFly) this.setState({ railFly: null });
    if (s.tool === 'cursor') {
      const hit = this.hitDraw(e);
      if (hit) { this.setState({ selDraw: hit.i, measure: null }); this.dragDraw(e, hit); return; }
      if (s.selDraw != null) this.setState({ selDraw: null });
      const sx = e.clientX, v0 = s.view, spp = C.slots / Math.max(1, e.currentTarget.getBoundingClientRect().width), base = v0.end == null ? C.N - 1 : v0.end, minEnd = Math.min(v0.count, C.N) - 1;
      this.setState({ measure: null, panning: true });
      const mv = ev => { const ne = Math.max(minEnd, Math.min(C.N - 1, base - (ev.clientX - sx) * spp)); this.setState({ view: { count: v0.count, end: ne >= C.N - 1 ? null : ne } }); };
      const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); this.setState({ panning: false }); };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up); return;
    }
    const pt = this.ptFromEvt(e); if (!pt) return;
    const tool = s.tool, NP = { hline: 1, vline: 1, text: 1, channel: 3, pitch: 3, fibext: 3 }[tool] || 2;
    if (NP === 1) { this.addDrawing(tool === 'text' ? { type: 'text', a: pt, text: 'Note' } : { type: tool, a: pt }); return; }
    if (tool === 'brush') {
      this.setState({ draft: { type: 'brush', pts: [pt], a: pt, b: pt } });
      let raf = 0, pts = [pt]; const mv = ev => { const p2 = this.ptFromEvt(ev); if (!p2) return; pts.push(p2); if (!raf) raf = requestAnimationFrame(() => { raf = 0; this.setState(st => st.draft ? { draft: { ...st.draft, pts: pts.slice() } } : null); }); };
      const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); raf && cancelAnimationFrame(raf); if (pts.length > 2) this.addDrawing({ type: 'brush', pts, a: pts[0], b: pts[pts.length - 1] }); else this.setState({ draft: null }); };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); return;
    }
    const finish = d => { this.endClickDraw && this.endClickDraw(); if (!d) return; if (d.type === 'measure') return this.setState({ draft: null, measure: d, tool: 'cursor' }); if ((d.type === 'long' || d.type === 'short') && d.b.t === d.a.t && d.b.p === d.a.p) d = { ...d, b: { t: d.a.t + 24 * this.cur.TFms, p: d.a.p * (d.type === 'long' ? 1.02 : .98) } }; if (d.b.t !== d.a.t || d.b.p !== d.a.p || d.type === 'long' || d.type === 'short') this.addDrawing(d); else this.setState({ draft: null }); };
    if (this.endClickDraw && s.draft) { const st = s.draft.stage === 2 ? 'c' : 'b', d = { ...s.draft, [st]: pt }; if (NP === 3 && st === 'b') return this.setState({ draft: { ...d, stage: 2, c: pt } }); return finish(d); }
    this.setState({ draft: { type: tool, a: pt, b: pt, stage: 1 }, measure: null });
    const sx = e.clientX, sy = e.clientY; let moved = false;
    const mv = ev => { if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 4) moved = true; const p2 = this.ptFromEvt(ev); if (p2) this.setState(st => st.draft ? { draft: { ...st.draft, [st.draft.stage === 2 ? 'c' : 'b']: p2 } } : null); };
    const up = () => {
      window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      if (moved && NP === 2) { window.removeEventListener('pointermove', mv); return finish(this.state.draft); }
      if (moved && NP === 3) this.setState(st => st.draft ? { draft: { ...st.draft, stage: 2, c: st.draft.b } } : null);
      this.endClickDraw = () => { window.removeEventListener('pointermove', mv); this.endClickDraw = null; };
    };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  }
  dragDraw(e, hit) {
    const p0 = this.ptFromEvt(e); if (!p0) return; const mk = this.state.market, d0 = (this.state.drawings[mk] || [])[hit.i]; if (!d0) return;
    const sh = (q, dt, dp) => q && { t: q.t + dt, p: q.p + dp }; let raf = 0, last = null;
    const mv = ev => { const p = this.ptFromEvt(ev); if (!p) return; last = p; if (raf) return; raf = requestAnimationFrame(() => { raf = 0; const dt = last.t - p0.t, dp = last.p - p0.p; let d;
      if (hit.k === 'body') d = { ...d0, a: sh(d0.a, dt, dp), b: sh(d0.b, dt, dp), c: sh(d0.c, dt, dp), pts: d0.pts && d0.pts.map(q => sh(q, dt, dp)), s: d0.s != null ? d0.s + dp : d0.s };
      else if (hit.k === 's') d = { ...d0, s: last.p }; else d = { ...d0, [hit.k]: { ...last } };
      this.setState(st => { const cur = (st.drawings[mk] || []).slice(); cur[hit.i] = d; return { drawings: { ...st.drawings, [mk]: cur } }; }); }); };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  }
  drawGeom(d, X, Y, W, H, fmt, tl, sel) {
    const st = d.st || {}, c = st.c || 'var(--a)', w = st.w || 1.6, dash = st.dash === 'dash' ? '6 4' : st.dash === 'dot' ? '1.5 3.5' : 'none', f = v => v.toFixed(1);
    const P = q => q ? [X(q.t), Y(q.p)] : null, A = P(d.a), B = P(d.b) || A, Cc = P(d.c) || B, paths = [], labels = [], handles = [], segs = [], areas = [];
    const ln = (x1, y1, x2, y2, o = {}) => { paths.push({ d: 'M' + f(x1) + ' ' + f(y1) + 'L' + f(x2) + ' ' + f(y2), c: o.c || c, w: o.w || w, dash: o.dash || dash, fill: 'none', fo: 0 }); segs.push([x1, y1, x2, y2]); };
    const poly = (pts, fill, fo) => paths.push({ d: 'M' + pts.map(q => f(q[0]) + ' ' + f(q[1])).join('L') + 'Z', c: 'none', w: 0, dash: 'none', fill, fo });
    const lab = (x, y, text, bg, ink, tf) => labels.push({ x: f(x) + 'px', y: f(y) + 'px', text, bg, ink, tf: tf || 'translate(-50%,-50%)' });
    const far = (p, q, k = 6000) => { const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy) || 1; return [p[0] + dx / L * k, p[1] + dy / L * k]; };
    const T = d.type;
    if (T === 'trend' || T === 'arrow') { ln(A[0], A[1], B[0], B[1]); if (T === 'arrow') { const an = Math.atan2(B[1] - A[1], B[0] - A[0]), L = 11 + w * 2, h1 = [B[0] - L * Math.cos(an - .42), B[1] - L * Math.sin(an - .42)], h2 = [B[0] - L * Math.cos(an + .42), B[1] - L * Math.sin(an + .42)]; poly([B, h1, h2], c, 1); } }
    else if (T === 'ray') { const Fq = far(A, B); ln(A[0], A[1], Fq[0], Fq[1]); }
    else if (T === 'ext') { const F1 = far(A, B), F2 = far(B, A); ln(F2[0], F2[1], F1[0], F1[1]); }
    else if (T === 'hline') { ln(-10, A[1], W + 10, A[1]); lab(W - 6, A[1], fmt(d.a.p), c, 'var(--bg)', 'translate(-100%,-50%)'); }
    else if (T === 'vline') { ln(A[0], -40, A[0], H + 10); lab(A[0], H - 4, tl(d.a.t), c, 'var(--bg)', 'translate(-50%,-100%)'); }
    else if (T === 'channel') { const yOn = Math.abs(B[0] - A[0]) < .5 ? A[1] : A[1] + (B[1] - A[1]) * (Cc[0] - A[0]) / (B[0] - A[0]), off = Cc[1] - yOn; poly([A, B, [B[0], B[1] + off], [A[0], A[1] + off]], c, .08); ln(A[0], A[1], B[0], B[1]); ln(A[0], A[1] + off, B[0], B[1] + off); ln(A[0], A[1] + off / 2, B[0], B[1] + off / 2, { w: 1, dash: '4 4' }); if (d.c) handles.push({ k: 'c', x: (A[0] + B[0]) / 2, y: (A[1] + B[1]) / 2 + off }); }
    else if (T === 'rect') { const x1 = Math.min(A[0], B[0]), x2 = Math.max(A[0], B[0]), y1 = Math.min(A[1], B[1]), y2 = Math.max(A[1], B[1]); poly([[x1, y1], [x2, y1], [x2, y2], [x1, y2]], c, .08); ln(x1, y1, x2, y1); ln(x2, y1, x2, y2); ln(x2, y2, x1, y2); ln(x1, y2, x1, y1); areas.push([x1, y1, x2, y2]); }
    else if (T === 'circle') { const rx = Math.max(1, Math.abs(B[0] - A[0])), ry = Math.max(1, Math.abs(B[1] - A[1])), dd = 'M' + f(A[0] - rx) + ' ' + f(A[1]) + 'A' + f(rx) + ' ' + f(ry) + ' 0 1 0 ' + f(A[0] + rx) + ' ' + f(A[1]) + 'A' + f(rx) + ' ' + f(ry) + ' 0 1 0 ' + f(A[0] - rx) + ' ' + f(A[1]); paths.push({ d: dd + 'Z', c, w, dash, fill: c, fo: .07 }); areas.push([A[0] - rx, A[1] - ry, A[0] + rx, A[1] + ry]); }
    else if (T === 'brush') { const pts = (d.pts || []).map(P); if (pts.length > 1) { paths.push({ d: 'M' + pts.map(q => f(q[0]) + ' ' + f(q[1])).join('L'), c, w: Math.max(w, 2), dash: 'none', fill: 'none', fo: 0 }); for (let i = 1; i < pts.length; i++) segs.push([pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]]); } }
    else if (T === 'fib' || T === 'fibext') {
      const LV = T === 'fib' ? [[0, 'var(--t3)'], [.236, 'var(--rd)'], [.382, 'var(--am)'], [.5, 'var(--g)'], [.618, 'var(--a)'], [.786, '#5B8DEF'], [1, 'var(--t3)']] : [[0, 'var(--t3)'], [.618, 'var(--am)'], [1, 'var(--g)'], [1.618, 'var(--a)'], [2.618, '#5B8DEF']];
      const base = T === 'fib' ? d.b.p : (d.c || d.b).p, rng = T === 'fib' ? d.b.p - d.a.p : d.b.p - d.a.p, x1 = T === 'fib' ? Math.min(A[0], B[0]) : Cc[0], x2 = T === 'fib' ? Math.max(A[0], B[0]) : Cc[0] + Math.max(80, Math.abs(B[0] - A[0]));
      let py = null; LV.forEach(([lv, lc]) => { const p = T === 'fib' ? base - rng * lv : base + rng * lv, yy = Y(p); if (py != null) poly([[x1, py], [x2, py], [x2, yy], [x1, yy]], lc, .08); ln(x1, yy, x2, yy, { c: lc, w: 1.2, dash: 'none' }); py = yy; lab(x1 + 2, yy, lv + ' · ' + fmt(p), 'transparent', lc, 'translate(0,-115%)'); });
      paths.push({ d: 'M' + f(A[0]) + ' ' + f(A[1]) + 'L' + f(B[0]) + ' ' + f(B[1]) + (T === 'fibext' && d.c ? 'L' + f(Cc[0]) + ' ' + f(Cc[1]) : ''), c: 'var(--t3)', w: 1, dash: '3 3', fill: 'none', fo: 0 });
      if (T === 'fibext' && d.c) handles.push({ k: 'c', x: Cc[0], y: Cc[1] });
    }
    else if (T === 'pitch') { const M = [(B[0] + Cc[0]) / 2, (B[1] + Cc[1]) / 2], v = [M[0] - A[0], M[1] - A[1]], Fm = far(A, M), Fb = far(B, [B[0] + v[0], B[1] + v[1]]), Fc = far(Cc, [Cc[0] + v[0], Cc[1] + v[1]]); if (d.c) { poly([B, Fb, Fc, Cc], c, .06); ln(B[0], B[1], Fb[0], Fb[1]); ln(Cc[0], Cc[1], Fc[0], Fc[1]); ln(B[0], B[1], Cc[0], Cc[1], { w: 1, dash: '4 4' }); handles.push({ k: 'c', x: Cc[0], y: Cc[1] }); } ln(A[0], A[1], Fm[0], Fm[1]); }
    else if (T === 'prange' || T === 'drange') { const x1 = Math.min(A[0], B[0]), x2 = Math.max(A[0], B[0]), y1 = Math.min(A[1], B[1]), y2 = Math.max(A[1], B[1]), dp = d.b.p - d.a.p, up = dp >= 0, cc = st.c || (T === 'prange' ? (up ? 'var(--g)' : 'var(--rd)') : 'var(--a)'); poly([[x1, y1], [x2, y1], [x2, y2], [x1, y2]], cc, .12); areas.push([x1, y1, x2, y2]);
      if (T === 'prange') { const xm = (x1 + x2) / 2; ln(xm, A[1], xm, B[1], { c: cc, w: 1.4, dash: 'none' }); ln(x1, A[1], x2, A[1], { c: cc, w: 1, dash: 'none' }); ln(x1, B[1], x2, B[1], { c: cc, w: 1, dash: 'none' }); lab(xm, up ? y1 - 6 : y2 + 6, (up ? '+' : '−') + fmt(Math.abs(dp)) + ' (' + (up ? '+' : '−') + (Math.abs(dp / d.a.p) * 100).toFixed(2) + '%)', cc, 'var(--bg)', up ? 'translate(-50%,-100%)' : 'translate(-50%,0)'); }
      else { const ym = (y1 + y2) / 2, bars = Math.round(Math.abs(d.b.t - d.a.t) / this.cur.TFms), ms = Math.abs(d.b.t - d.a.t), hrs = ms / 36e5; ln(A[0], ym, B[0], ym, { c: cc, w: 1.4, dash: 'none' }); ln(A[0], y1, A[0], y2, { c: cc, w: 1, dash: 'none' }); ln(B[0], y1, B[0], y2, { c: cc, w: 1, dash: 'none' }); lab((x1 + x2) / 2, y2 + 6, bars + ' bars · ' + (hrs >= 48 ? (hrs / 24).toFixed(1) + 'd' : hrs >= 1 ? hrs.toFixed(1) + 'h' : Math.round(ms / 6e4) + 'm'), cc, 'var(--bg)', 'translate(-50%,0)'); } }
    else if (T === 'long' || T === 'short') { const e = d.a.p, tp = d.b.p, sl = d.s != null ? d.s : e - (tp - e) / 2, x1 = A[0], x2 = Math.max(B[0], A[0] + 30), ye = Y(e), yt = Y(tp), ys = Y(sl), rr = Math.abs(tp - e) / Math.max(1e-12, Math.abs(e - sl));
      poly([[x1, ye], [x2, ye], [x2, yt], [x1, yt]], 'var(--g)', .16); poly([[x1, ye], [x2, ye], [x2, ys], [x1, ys]], 'var(--rd)', .16); ln(x1, ye, x2, ye, { c: 'var(--t2)', w: 1.2, dash: 'none' }); areas.push([x1, Math.min(yt, ys), x2, Math.max(yt, ys)]);
      const xm = (x1 + x2) / 2, pc = v => ((v / e - 1) * 100).toFixed(2) + '%';
      lab(xm, yt, 'Target ' + fmt(tp) + ' · ' + (tp >= e ? '+' : '') + pc(tp), 'var(--gf)', 'var(--gi)', yt < ye ? 'translate(-50%,-115%)' : 'translate(-50%,15%)');
      lab(xm, ys, 'Stop ' + fmt(sl) + ' · ' + (sl >= e ? '+' : '') + pc(sl), 'var(--rf)', 'var(--ri)', ys > ye ? 'translate(-50%,15%)' : 'translate(-50%,-115%)');
      lab(x1 + 4, ye, (tp >= e ? 'Long' : 'Short') + ' · RR ' + rr.toFixed(2), 'var(--p)', 'var(--t)', 'translate(0,-50%)');
      handles.push({ k: 'a', x: x1, y: ye }, { k: 'b', x: x2, y: yt }, { k: 's', x: x2, y: ys }); }
    else if (T === 'text') { const tx = d.text || 'Note', tw = tx.length * 7 + 14; lab(A[0], A[1], tx, 'color-mix(in oklch, ' + c + ' 22%, var(--p))', c, 'translate(0,-50%)'); areas.push([A[0], A[1] - 11, A[0] + tw, A[1] + 11]); }
    if (!['long', 'short', 'brush', 'text'].includes(T)) { handles.unshift({ k: 'a', x: A[0], y: A[1] }); if (d.b && !['hline', 'vline'].includes(T)) handles.splice(1, 0, { k: 'b', x: B[0], y: B[1] }); }
    if (T === 'text') handles.push({ k: 'a', x: A[0], y: A[1] });
    if (sel) paths.forEach(q => { if (q.c !== 'none' && q.w) paths.push({ ...q, w: q.w + 6, so: .22 }); });
    return { paths, labels, handles, segs, areas };
  }
  vseries(range) {
    const V = this.K.VAULT, pts = store.vaultHistory.get(range) || [], now = Date.now();
    store.loadVaultHistory(range);
    // without snapshots yet, the chart is the current share price as a flat line
    if (pts.length < 2) return { vals: [V.price, V.price], ts: [now - 36e5, now] };
    return { vals: pts.map(q => q.sharePrice).concat([V.price]), ts: pts.map(q => q.t).concat([now]) };
  }
  vchart(range, hov) {
    const K = this.K, { vals, ts } = this.vseries(range), n = vals.length;
    const lo = Math.min(...vals), hi = Math.max(...vals), r = hi - lo || 1e-4, dlo = lo - r * .12, dhi = hi + r * .22;
    const raw = (dhi - dlo) / 4, e10 = Math.floor(Math.log10(raw) + 1e-9), mm = raw / 10 ** e10, mk = mm <= 1 ? 1 : mm <= 2 ? 2 : mm <= 2.5 ? 2.5 : mm <= 5 ? 5 : 10, stp = mk * 10 ** e10, dec = Math.max(0, -e10 - (mk === 10 ? 1 : 0)) + (mk === 2.5 ? 1 : 0);
    const Y = v => (dhi - v) / (dhi - dlo) * 1000, P = vals.map((v, i) => [i / (n - 1) * 1000, Y(v)]), d = [], tg = [];
    for (let i = 0; i < n - 1; i++) d.push((P[i + 1][1] - P[i][1]) / (P[i + 1][0] - P[i][0]));
    for (let i = 0; i < n; i++) tg.push(i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
    for (let i = 0; i < n - 1; i++) { if (!d[i]) { tg[i] = tg[i + 1] = 0; continue; } const a = tg[i] / d[i], c = tg[i + 1] / d[i], q = a * a + c * c; if (q > 9) { const k = 3 / Math.sqrt(q); tg[i] = k * a * d[i]; tg[i + 1] = k * c * d[i]; } }
    const f = x => x.toFixed(1), seg = (a, b) => { let s = 'M' + f(P[a][0]) + ' ' + f(P[a][1]); for (let i = a; i < b; i++) { const dx = (P[i + 1][0] - P[i][0]) / 3; s += 'C' + f(P[i][0] + dx) + ' ' + f(P[i][1] + tg[i] * dx) + ' ' + f(P[i + 1][0] - dx) + ' ' + f(P[i + 1][1] - tg[i + 1] * dx) + ' ' + f(P[i + 1][0]) + ' ' + f(P[i + 1][1]); } return s; };
    const fill = (a, b, s) => s ? s + 'L' + f(P[b][0]) + ' 1000L' + f(P[a][0]) + ' 1000Z' : '';
    const h = hov == null || hov >= n ? null : hov, cur = h == null ? n - 1 : h, lA = seg(0, cur), lB = cur < n - 1 ? seg(cur, n - 1) : '';
    const ticks = []; for (let v = Math.ceil(dlo / stp) * stp; v < dhi; v += stp) ticks.push({ y: (Y(v) / 10).toFixed(2) + '%', op: Math.abs(Y(v) - P[hov == null || hov >= n ? n - 1 : hov][1]) < 55 ? 0 : 1, label: K.num(v, dec) });
    const du = (x, o) => new Date(x).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC', ...o }), tu = x => new Date(x).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
    const v = vals[cur], chg = (v / vals[0] - 1) * 100, up = chg >= 0, xp = cur / (n - 1) * 100, yp = (P[cur][1] / 10).toFixed(2) + '%';
    return {
      vcLineA: lA, vcLineB: lB, vcFillA: fill(0, cur, lA), vcFillB: fill(cur, n - 1, lB), vcTicks: ticks,
      vcXs: [.1, .37, .63, .9].map(q => { const i = Math.round(q * (n - 1)); return { x: (i / (n - 1) * 100).toFixed(2) + '%', label: du(ts[i]) }; }),
      vcHov: h != null, vcIdle: h == null, vcX: xp.toFixed(2) + '%', vcY: yp, vcEndY: (P[n - 1][1] / 10).toFixed(2) + '%', vcDot: this.dot('var(--a)', true),
      vcXT: xp < 8 ? 'translateX(0)' : xp > 92 ? 'translateX(-100%)' : 'translateX(-50%)', vcDate: range === 'All' ? du(ts[cur]) : du(ts[cur]) + ' ' + tu(ts[cur]),
      vcTag: K.num(v, 4), vcTagY: yp, vcTagBg: h == null ? 'var(--af)' : 'var(--l2)', vcTagInk: h == null ? 'var(--ai)' : 'var(--t)',
      vcVal: K.num(v, 4), vcChg: K.num(Math.abs(chg), 2) + '%', vcChgC: up ? 'var(--g)' : 'var(--rd)', vcChgBg: up ? 'var(--gt)' : 'var(--rt)', vcArrow: up ? 'M12 19V5M5 12l7-7 7 7' : 'M12 5v14M5 12l7 7 7-7',
      vcSub: h == null ? (range !== 'All' && ts[0] > Date.now() - { '7D': 7, '30D': 30 }[range] * 864e5 * .97 ? 'Since ' + du(ts[0]) : { '7D': 'Past 7 days', '30D': 'Past 30 days', All: 'Since launch' }[range]) : range === 'All' ? du(ts[cur], { year: 'numeric' }) : du(ts[cur]) + ', ' + tu(ts[cur]) + ' UTC',
      vcMove: e => { const b = e.currentTarget.getBoundingClientRect(); this.vpend = Math.max(0, Math.min(n - 1, Math.round((e.clientX - b.left) / b.width * (n - 1)))); if (!this.vraf) this.vraf = requestAnimationFrame(() => { this.vraf = 0; if (this.vpend !== this.state.vhov) this.setState({ vhov: this.vpend }); }); },
      vcLeave: () => { this.vraf && cancelAnimationFrame(this.vraf); this.vraf = 0; if (this.state.vhov != null) this.setState({ vhov: null }); },
    };
  }
  earnView(V, mine) {
    const K = this.K, E = store.earnings, n6 = v => Number(v || 0) / 1e6, day0 = Math.floor(Date.now() / 864e5) * 864e5;
    store.loadEarnings();
    const src = [
      { k: 'fees', label: 'Trading fees', desc: 'Open, close, borrow and liquidation fees', v: 0, c: 'var(--a)', tint: 'var(--at)', icon: 'M7 17L17 7M8 7h9v9' },
      { k: 'funding', label: 'Funding', desc: 'Net paid by the crowded side', v: 0, c: 'var(--g)', tint: 'var(--gt)', icon: 'M4 12a8 8 0 0114-5.3M20 12a8 8 0 01-14 5.3M18 3v4h-4M6 21v-4h4' },
      { k: 'traders', label: 'Trader losses', desc: 'Net of trader wins; vault is the counterparty', v: 0, c: 'var(--t2)', tint: 'var(--r)', icon: 'M3 17l6-6 4 4 8-8M21 7v5M21 7h-5' },
    ];
    const rows = E && E.days.length ? E.days : Array.from({ length: 30 }, (_, i) => ({ t: day0 - (29 - i) * 864e5 }));
    const days = rows.map(d => [n6(d.fees) + n6(d.borrow) + n6(d.liquidation), n6(d.funding), n6(d.traders)]), dts = rows.map(d => d.t);
    src.forEach((x, j) => { x.v = days.reduce((a, d) => a + d[j], 0); });
    const h = this.state.ehov, hs = this.state.esrc;
    const pos = days.map(d => d.reduce((a, v) => a + Math.max(0, v), 0)), neg = days.map(d => d.reduce((a, v) => a - Math.min(0, v), 0));
    const mp = Math.max(...pos), mn = Math.max(...neg), rng = (mp + mn) || 1, base = mn / rng * 100;
    const tot = src.reduce((a, x) => a + x.v, 0), aprOf = v => V.apr != null && tot ? K.num(v / tot * V.apr, 1) + '%' : '—';
    const du = i => new Date(dts[i]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    const dn = h != null ? days[h].reduce((a, v) => a + v, 0) : 0;
    return {
      eTot: K.sUsd(tot, 0), eSub: V.apr != null ? K.num(V.apr, 1) + '% APR' : 'APR shows after an hour of history', eBase: base.toFixed(1) + '%', eD0: du(0), eD1: du(15),
      eHovLabel: h != null ? du(h) : hs != null ? src[hs].label + ' · daily avg' : 'Daily avg', eHovVal: h != null ? K.sUsd(dn, 0) : K.sUsd((hs != null ? src[hs].v : tot) / days.length, 0), eHovC: (h != null ? dn : 1) >= 0 ? 'var(--g)' : 'var(--rd)',
      eLeave: () => (this.state.ehov != null || this.state.esrc != null) && this.setState({ ehov: null, esrc: null }),
      eDays: days.map((d, i) => { const segs = src.map((x, j) => ({ f: Math.max(0, d[j]), c: x.c, j })).filter(g => g.f > 0); return {
        ph: (pos[i] / rng * 100).toFixed(1) + '%', nh: (neg[i] / rng * 100).toFixed(1) + '%', op: h == null || h === i ? 1 : .35, nop: (h == null || h === i) && (hs == null || hs === 2) ? .85 : .3,
        segs: segs.map((g, k) => ({ f: g.f, c: g.c, r: k === segs.length - 1 ? '2px 2px 0 0' : '0', ...(hs != null && hs !== g.j ? { c: 'var(--l2)' } : {}) })),
        on: () => this.state.ehov !== i && this.setState({ ehov: i }) }; }),
      earn: src.map((x, j) => ({ ...x, value: K.sUsd(x.v, 0), apr: aprOf(x.v), w: (Math.abs(x.v) / Math.max(...src.map(y => Math.abs(y.v))) * 100).toFixed(1) + '%', op: hs == null || hs === j ? 1 : .45, on: () => this.setState({ esrc: j, ehov: null }) })),
      eYouLabel: mine > 0 ? `Your share, ${days.length}d` : 'Deposit to earn a share', eYou: mine > 0 ? K.sUsd(V.nav ? tot * mine / V.nav : 0, 2) : V.apr != null ? K.num(V.apr, 1) + '% APR' : '—', eYouC: mine > 0 ? 'var(--g)' : 'var(--t)',
    };
  }
  dot(color, live) { const k = color + live; this._dots = this._dots || {}; if (!this._dots[k]) this._dots[k] = React.createElement('span', { style: { position: 'relative', width: 6, height: 6, flex: 'none', display: 'inline-block' } }, live ? React.createElement('span', { key: 'r', style: { position: 'absolute', inset: 0, borderRadius: '50%', background: color, animation: 'kping 1.8s cubic-bezier(0,0,.2,1) infinite' } }) : null, React.createElement('span', { key: 'd', style: { position: 'absolute', inset: 0, borderRadius: '50%', background: color } })); return this._dots[k]; }
  num(v) { const n = parseFloat(String(v).replace(/,/g, '')); return isFinite(n) ? n : 0; }
  /** Pulls the trader's live account and history into the view state; announces fills the keeper made. */
  syncFromStore() {
    const z = this.props.zap, on = !!(z && z.user), d = fromAccount(on ? store.account : null, on ? store.history : []);
    d.positions.forEach(p => { p.owed = Act.owedUsd(p.raw); });
    if (on && this.seenFills) for (const f of store.history) if (!this.seenFills.has(f.sig + f.kind) && KEEPER.includes(f.kind) && Number(f.ts) * 1000 > this.t0 - 5000) this.keeperNote(f);
    this.seenFills = on && store.history.length ? new Set(store.history.map(f => f.sig + f.kind)) : on && store.accountLoaded ? new Set() : null;
    this.setState(d);
  }
  keeperNote(f) {
    const K = this.K, h = toHistory(f), m = K.byId[h.market], dc = m ? m.dec : 2, sd = h.action.split(' ').pop();
    const title = { 2: `Liquidated · ${h.market}`, 3: `Take profit hit · ${h.market}`, 4: `Stop loss hit · ${h.market}`, 5: `Limit order filled · ${h.market}`, 6: `Stop order filled · ${h.market}` }[f.kind];
    const body = h.pnl == null ? `${sd} ${K.usd(h.size)} at ${K.num(h.price, dc)}` : `${K.sUsd(h.pnl)} realized at ${K.num(h.price, dc)}`;
    const id = 'k' + f.sig + f.kind; this.push({ id, kind: f.kind === 2 ? 'error' : 'success', title, body, link: K.txUrl(f.sig) }); setTimeout(() => this.dismiss(id), 12000);
  }
  faucet() {
    const z = this.props.zap, K = this.K, id = 'f' + Date.now();
    this.setState({ menu: false });
    this.push({ id, kind: 'pending', title: `Get ${K.num(z.faucetAmount, 0)} test USDC`, step: 0 });
    z.faucet().then(r => { this.push({ id, kind: 'success', title: `Received ${K.num(r.amount, 0)} test USDC`, body: 'In your wallet · deposit it to trade', link: K.txUrl(r.signature) }); setTimeout(() => this.dismiss(id), 9000); },
      e => { this.push({ id, kind: 'error', title: 'Faucet unavailable', body: (e && e.message) || String(e) }); setTimeout(() => this.dismiss(id), 9000); });
  }
  saveAlerts = () => { try { localStorage.setItem('zap-alerts', JSON.stringify(this.state.alerts)); } catch (e) {} };
  componentDidMount() {
    this.t0 = Date.now();
    let lay = {}; try { lay = JSON.parse(localStorage.getItem('keel-layout') || '{}'); } catch (e) {}
    this.setState({ page: this.props.page || 'trade', ...lay });
    this.syncFromStore();
    this.un = K.subscribe(() => { if (document.hidden || this.traf) return; this.traf = requestAnimationFrame(() => { this.traf = 0; this.syncFromStore(); this.checkOrders(); }); });
    this.ro = new ResizeObserver(es => { const w = Math.round(es[0].contentRect.width); if (w && w !== this.state.w) this.setState({ w }); });
    if (this.root) { this.ro.observe(this.root); const w0 = Math.round(this.root.getBoundingClientRect().width); if (w0) this.setState({ w: w0 }); }
    this.clk = setInterval(() => { if (!document.hidden) this.forceUpdate(); }, 1000);
    this.onKey = e => {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') { if (e.key === 'Escape') e.target.blur(); return; }
      if (e.key === '/') { e.preventDefault(); if (this.state.page === 'trade') this.setState({ switcher: true, swq: '' }); else this.setState({ page: 'markets' }, () => this.searchEl && this.searchEl.focus()); }
      else if (e.key === '?') this.setState({ keys: true });
      else if (this.state.page === 'trade' && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'b' || e.key === 's')) { const sd = e.key === 'b' ? 'long' : 'short', r = this._rs && this._rs[sd]; if (r) this.err(r, 'Hotkey ' + e.key.toUpperCase() + ' · fix the order form first'); else this.request(sd); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && this.state.selDraw != null) { e.preventDefault(); this.delDrawing(this.state.selDraw); }
      else if (e.key === 'Escape') this.endClickDraw && this.endClickDraw(), this.setState({ selDraw: null, mmOpen: false, ctx: null, railFly: null, indPick: false, indEdit: null, keys: false, switcher: false, confirm: null, edit: null, calc: null, alOpen: false, menu: false, settings: false, tool: 'cursor', draft: null, measure: null, menu2: null, chartFull: false });
    };
    window.addEventListener('keydown', this.onKey);
  }
  componentDidUpdate(pp) {
    const P = this.props;
    if (pp.page !== P.page && P.page) this.setState({ page: P.page });
    if ((pp.zap && pp.zap.user && pp.zap.user.owner) !== (P.zap && P.zap.user && P.zap.user.owner)) { this.seenFills = null; this.syncFromStore(); }
  }
  componentWillUnmount() { this.pro && this.pro.disconnect(); this.un && this.un(); this.ro && this.ro.disconnect(); clearInterval(this.clk); this.traf && cancelAnimationFrame(this.traf); window.removeEventListener('keydown', this.onKey); }
  go(page) { this.setState({ page, switcher: false, settings: false, menu: false, preSide: '' }); }
  push(t) { this.setState(s => ({ toasts: s.toasts.some(x => x.id === t.id) ? s.toasts.map(x => x.id === t.id ? t : x) : [...s.toasts, t].slice(-4) })); }
  dismiss(id) { this.setState(s => ({ toasts: s.toasts.filter(x => x.id !== id) })); }
  impact(size, side) { const m = this.K.byId[this.state.market], q = m && size > 0 && Act.quote(m.index, size, (side || this.state.side) !== 'short'); return q ? size * q.impact : 0; }
  borrow() { return Act.borrowHourly(); }
  note(title, body, sg) { const id = 'n' + Date.now() + Math.random(); this.push({ id, kind: 'success', title, body, link: this.K.txUrl(sg) }); setTimeout(() => this.dismiss(id), 9000); }
  isCross() { return false; }
  liq(p) { return this.K.liqOf(p); }
  err(title, body) { const id = 'e' + Date.now() + Math.random(); this.push({ id, kind: 'error', title, body }); setTimeout(() => this.dismiss(id), 6000); }
  formMargin() {
    const s = this.state, K = this.K, m = K.byId[s.market], lev = Math.min(s.lev, m.max), mode = s.inMode || 'margin';
    if (mode === 'margin') return this.num(s.margin);
    const v = this.num(s.sizeIn), ref = (s.otype === 'limit' || s.otype === 'stop') && this.num(s.px) ? this.num(s.px) : K.live.p[m.id];
    if (mode === 'risk') { const sl = s.tpsl ? this.num(s.sl) : 0, dist = sl ? Math.abs(ref - sl) / ref : 0; return dist > 0 ? (s.usdc * v / 100) / (dist + 2 * K.FEE) / lev : 0; }
    return mode === 'usd' ? v / lev : v * ref / lev;
  }
  open(side) { Act.open(this, side); }
  addAlert(market, price) {
    const K = this.K, mk = K.live.p[market], d = K.byId[market].dec, dir = price > mk ? 'above' : 'below';
    this.setState(st => ({ alerts: [...st.alerts, { id: Date.now(), market, price, dir, t: Date.now() }] }), this.saveAlerts);
    const id = 'al' + Date.now(); this.push({ id, kind: 'success', title: `Alert set · ${market}`, body: `When price crosses ${dir} ${K.num(price, d)}` }); setTimeout(() => this.dismiss(id), 5000);
  }
  removeAlert(a) { this.setState(st => ({ alerts: st.alerts.filter(x => x.id !== a.id) }), this.saveAlerts); }
  fireAlert(a, mk) {
    const K = this.K, d = K.byId[a.market].dec, id = 'af' + a.id;
    this.setState(st => ({ alerts: st.alerts.filter(x => x.id !== a.id) }), this.saveAlerts);
    this.push({ id, kind: 'success', title: `Price alert · ${a.market}`, body: `Crossed ${a.dir} ${K.num(a.price, d)} · now ${K.num(mk, d)}` }); setTimeout(() => this.dismiss(id), 9000);
  }
  lineDown(e, ln) {
    if (e.button !== 0) return; e.stopPropagation(); e.preventDefault();
    const K = this.K, d = K.byId[ln.market].dec;
    const toP = y => { const el = this.lnEl, C = this.cur && this.cur.C; if (!el || !C) return ln.p0; const r = el.getBoundingClientRect(), f = Math.min(1, Math.max(0, (y - r.top) / Math.max(1, r.height))); return +(C.hi - f * (C.hi - C.lo)).toFixed(d); };
    let last = ln.p0, moved = false, raf = 0;
    this.setState({ lineDrag: { key: ln.key, p: ln.p0 } });
    const mv = ev => { last = toP(ev.clientY); moved = true; if (!raf) raf = requestAnimationFrame(() => { raf = 0; this.setState({ lineDrag: { key: ln.key, p: last } }); }); };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); raf && cancelAnimationFrame(raf); this.setState({ lineDrag: null }); if (moved && last !== ln.p0) this.commitLine(ln, last); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  }
  commitLine(ln, p) {
    const K = this.K, s = this.state, d = K.byId[ln.market].dec, mk = K.live.p[ln.market];
    if (ln.kind === 'tp' || ln.kind === 'sl') {
      const pos = s.positions.find(x => x.id === ln.pid); if (!pos) return; const L = pos.side === 'long', liq = this.liq(pos), nm = ln.kind === 'tp' ? 'Take profit' : 'Stop loss';
      if (ln.kind === 'tp' && (L ? p <= mk : p >= mk)) return this.err(`TP must be ${L ? 'above' : 'below'} mark`, 'Change not saved');
      if (ln.kind === 'sl' && (L ? p >= mk : p <= mk)) return this.err(`SL must be ${L ? 'below' : 'above'} mark`, 'Change not saved');
      if (ln.kind === 'sl' && (L ? p <= liq : p >= liq)) return this.err('SL is past the liquidation price', 'Change not saved');
      return this.hold(ln, p);
    }
    if (ln.kind === 'order') {
      const o = s.orders.find(x => x.id === ln.oid); if (!o) return; const L = o.side === 'long';
      if (o.type === 'limit' && (L ? p >= mk : p <= mk)) return this.err(`Limit ${o.side} must be ${L ? 'below' : 'above'} mark`, 'Order not moved');
      if (o.type === 'stop' && (L ? p <= mk : p >= mk)) return this.err(`Stop ${o.side} must be ${L ? 'above' : 'below'} mark`, 'Order not moved');
      return this.hold(ln, p);
    }
    if (ln.kind === 'alert') this.setState(st => ({ alerts: st.alerts.map(x => x.id === ln.aid ? { ...x, price: p, dir: p > mk ? 'above' : 'below' } : x) }), this.saveAlerts);
  }
  /** Keeps a dragged line at its new price while the change confirms (and briefly after, until the account catches up). */
  hold(ln, p) {
    this.setState({ lineHold: { key: ln.key, p, until: Date.now() + 60000 } });
    Act.moveLine(this, ln, p, ok => this.setState(st => st.lineHold && st.lineHold.key === ln.key ? { lineHold: ok ? { ...st.lineHold, until: Date.now() + 4000 } : null } : null));
  }
  checkOrders() {
    const K = this.K, s = this.state; this.firing = this.firing || new Set();
    for (const a of s.alerts || []) { const key = 'a' + a.id; if (this.firing.has(key)) continue; const mk = K.live.p[a.market]; if (mk && (a.dir === 'above' ? mk >= a.price : mk <= a.price)) { this.firing.add(key); this.fireAlert(a, mk); } }
  }
  cancelOrder(o) { Act.cancelOrder(this, o); }
  reverse(p) { Act.reverse(this, p); }
  closeAll() { Act.closeAll(this); }
  ctxOrder(side, p) { const lp = this.K.live.p[this.state.market], type = side === 'long' ? (p < lp ? 'limit' : 'stop') : (p > lp ? 'limit' : 'stop'); this.setState({ ctx: null, otype: type, px: String(p), ro: false, tif: 'gtc', side }, () => { const r = this._rs && this._rs[side]; if (r) return this.err(r, 'Adjust the order form and try again'); this.request(side); }); }
  clearTrig(p, k) { Act.clearTrig(this, p, k); }
  editColl(p, d) { Act.editColl(this, p, d); }
  reduce(p, f) { Act.reduce(this, p, f); }
  saveTpsl(p, tp, sl) { Act.saveTpsl(this, p, tp, sl); }
  close(p) { Act.close(this, p); }
  request(side) { const z = this.props.zap; if (!z.user) return; if (!z.tradingReady) return z.requireTrading(); if (this.state.confirmOn) this.setState({ confirm: side }); else this.open(side); }
  vaultGo() { Act.vault(this); }
  drag(kind) {
    return e => {
      e.preventDefault(); const sx = e.clientX, sy = e.clientY, s0 = { ...this.state }, fl = this.props.layout === 'Form left', cl = (v, a, b) => Math.min(b, Math.max(a, v));
      const mv = ev => { const dx = ev.clientX - sx, dy = ev.clientY - sy; this.setState(kind === 'bp' ? { bpH: cl(s0.bpH - dy, 140, 560) } : kind === 'tr' ? { trW: cl(s0.trW - dx, 180, 420) } : { ofW: cl(s0.ofW + (fl ? dx : -dx), 290, 460) }); };
      const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); this.saveLay(); };
      window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
    };
  }
  saveLay() { const { bpH, trW, ofW } = this.state; try { localStorage.setItem('keel-layout', JSON.stringify({ bpH, trW, ofW })); } catch (e) {} }
  resetLay(k) { const d = { bp: { bpH: 270 }, tr: { trW: 240 }, of: { ofW: 320 } }[k]; return () => this.setState(d, () => this.saveLay()); }

  renderVals() {
    const P = this.props, s = this.state, K = this.K;
    const theme = P.theme === 'light' ? 'light' : 'dark', ac = (ACCENTS[P.accent] || ACCENTS['#7B5CFA'])[theme];
    const device = (typeof window !== 'undefined' && window.__zapDevice) || P.device || 'auto', phone = device === 'phone' || (device === 'auto' && s.w < 900), desktop = !phone, wide = desktop && s.w >= 1280;
    const outer = device === 'phone' ? { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '28px', boxSizing: 'border-box', background: theme === 'light' ? '#D5DAE2' : '#020305' } : {};
    const inner = { ...THEMES[theme], ...(DENS[P.density] || DENS.compact), '--a': ac[0], '--af': ac[1], '--ai': ac[2], '--at': ac[3], colorScheme: theme, position: 'relative', ...(device === 'phone' ? { width: '410px', height: '864px', borderRadius: '46px', overflow: 'hidden', border: '10px solid #16191F', boxSizing: 'border-box', boxShadow: '0 30px 80px rgba(0,0,0,.45)', flex: 'none' } : { height: '100vh', minWidth: device === 'desktop' ? '1200px' : 0 }) };
    if (!this.spinner) this.spinner = React.createElement('span', { style: { width: 14, height: 14, boxSizing: 'border-box', borderRadius: '50%', border: '2px solid var(--l2)', borderTopColor: 'currentColor', animation: 'kspin .8s linear infinite', display: 'inline-block', flex: 'none' } });
    const base = { outer, inner, phone, desktop, rootRef: this.rootRef, searchRef: this.searchRef, stop: this.stop, spinner: this.spinner };
    if (!K.MARKETS.length || !K.byId[s.market]) return { ...base, ready: false };
    K.setActiveMarket(s.market);

    const z = P.zap, sc = 'live', banner = !store.pool ? 'uninit' : !store.connected ? 'rpc' : 'none', conn = !!z.user, loading = false, staleAll = false, now = Date.now(), D = '—';
    const m = K.byId[s.market];
    const priceOf = id => { if (staleAll) { if (this.frozen[id] == null) this.frozen[id] = K.live.p[id]; return this.frozen[id]; } return K.live.p[id]; };
    const isStale = x => staleAll || !!x.stale;
    const ageOf = x => K.ageOf(x.id);
    const flashC = id => { if (staleAll) return 'var(--t)'; const f = K.flash(id); return f === 'up' ? 'var(--g)' : f === 'down' ? 'var(--rd)' : 'var(--t)'; };
    const flashBg = id => { if (staleAll) return 'transparent'; const fl = K.flash(id); return fl === 'up' ? 'var(--gt)' : fl === 'down' ? 'var(--rt)' : 'transparent'; };
    const gc = v => v >= 0 ? 'var(--g)' : 'var(--rd)';
    const lp = priceOf(m.id), stale = isStale(m), positions = s.positions;
    // PnL at the oracle mid net of the borrow and funding each position owes; margin in use includes open orders' escrow
    const upnl = positions.reduce((a, p) => a + K.pnlOf(p, priceOf(p.market)) - p.owed, 0), used = positions.reduce((a, p) => a + p.margin, 0) + s.orders.reduce((a, o) => a + o.margin + o.fee, 0), equity = s.usdc + used + upnl;

    // header / chrome
    const pages = [['markets', 'Markets'], ['trade', 'Trade'], ['portfolio', 'Portfolio'], ['vault', 'Vault'], ['leaderboard', 'Leaderboard']];
    const nav = [pages[1], pages[0], pages[2], pages[3], pages[4]].map(([id, label]) => ({ label, go: () => this.go(id), color: s.page === id ? 'var(--t)' : 'var(--t2)', bar: s.page === id ? 'var(--a)' : 'transparent' }));
    const tabs = pages.map(([id, label]) => ({ label, d: TABS_D[id], go: () => this.go(id), color: s.page === id ? 'var(--a)' : 'var(--t3)', bg: s.page === id ? 'var(--at)' : 'transparent' }));
    const cid = 'c' + now;
    const faucetWait = z.faucetReadyAt && z.faucetReadyAt > now ? z.faucetReadyAt - now : 0;
    const menuItems = [
      { label: `Get ${K.num(z.faucetAmount, 0)} test USDC`, hint: faucetWait ? 'in ' + K.age(faucetWait / 1000) : '', color: faucetWait ? 'var(--t3)' : 'var(--a)', on: () => { if (faucetWait) return; this.faucet(); } },
      { label: 'Deposit / withdraw', hint: '', color: 'var(--t)', on: () => { this.setState({ menu: false }); z.openFunds('deposit'); } },
      { label: 'Copy address', hint: '', color: 'var(--t)', on: () => { try { navigator.clipboard.writeText(K.ADDR); } catch (e) {} this.setState({ menu: false }); this.push({ id: cid, kind: 'success', title: 'Address copied' }); setTimeout(() => this.dismiss(cid), 2500); } },
      { label: 'View on explorer', hint: '↗', color: 'var(--t)', on: () => { window.open(K.addrUrl, '_blank'); this.setState({ menu: false }); } },
      ...(z.tradingReady ? [{ label: 'Turn off 1-click trading', hint: '', color: 'var(--t)', on: () => { this.setState({ menu: false }); z.revokeSession().then(() => { const id = 'rv' + Date.now(); this.push({ id, kind: 'success', title: '1-click trading off', body: 'This browser can no longer trade without your wallet' }); setTimeout(() => this.dismiss(id), 5000); }, e => this.err('Could not turn off 1-click trading', (e && e.message) || String(e))); } }] : []),
      { label: 'Log out', hint: '', color: 'var(--rd)', on: () => { this.setState({ menu: false, auStep: 'main', auCode: '', auErr: '', auBusy: '' }); z.logout(); } },
    ];
    const wallets = [['Phantom', '#AB9FF2'], ['Backpack', '#E33E3F'], ['Solflare', '#FC7227']].map(([name, c]) => ({ name, c, init: name[0], logo: WL[name], pick: () => z.loginWallet(name) }));
    const rpcDown = banner === 'rpc';
    const steps = ['Preparing…', 'Submitting…', 'Confirming…'];
    const toasts = s.toasts.map(t => { const st = t.step || 0; return { ...t, pending: t.kind === 'pending', success: t.kind === 'success', error: t.kind === 'error', stepText: steps[st], s0: 'var(--a)', s1: st >= 1 ? 'var(--a)' : 'var(--l2)', s2: st >= 2 ? 'var(--a)' : 'var(--l2)', body: t.body || '', link: t.link || '', close: () => this.dismiss(t.id) }; });

    const chrome = {
      tkMore: !!s.tkMore, toggleTkMore: () => this.setState({ tkMore: !s.tkMore }), tkMoreLabel: s.tkMore ? 'Less' : 'More stats', tkMoreLabelP: s.tkMore ? 'Hide details' : 'Market details', tkRot: s.tkMore ? 'rotate(180deg)' : 'none',
      acctOpen: !!s.acctOpen, toggleAcct: () => this.setState({ acctOpen: !s.acctOpen }), acctRot: s.acctOpen ? 'rotate(180deg)' : 'none',
      toggleRail: () => this.setState({ drawOn: !s.drawOn }), railBtnBg: s.drawOn ? 'var(--h)' : 'transparent',
      ready: true, connected: conn, disconnected: !conn, nav, tabs, menuItems, wallets, menu: s.menu && conn, walletModal: false, keys: s.keys, walletName: z.user ? z.user.walletName : '', walletLogo: z.user ? z.user.walletLogo : '', walletLabel: z.user ? z.user.label : '',
      usdcText: K.num(s.usdc), usdcShort: K.num(s.usdc, 0) + ' USDC', openFunds: () => z.openFunds('deposit'), devOracle: store.oracleMode === 'dev', cluster: String((store.config && store.config.cluster) || 'devnet'), clusterTag: String((store.config && store.config.cluster) || 'devnet').toUpperCase(), addrShort: K.ADDR.slice(0, 4) + '…' + K.ADDR.slice(-4), addrMid: K.ADDR.slice(0, 8) + '…' + K.ADDR.slice(-8), addrUrl: K.addrUrl, balDisp: s.w >= 1100 ? 'flex' : 'none',
      goMarkets: () => this.go('markets'), mint: () => this.faucet(),
      toggleMenu: () => this.setState({ menu: !s.menu }), openWallet: () => this.setState({ walletModal: true }), closeWallet: () => this.setState({ walletModal: false }), openKeys: () => this.setState({ keys: true }), closeKeys: () => this.setState({ keys: false }),
      shortcuts: [{ label: 'Search markets / open market switcher', key: '/' }, { label: 'Long / short with the current order form', key: 'B / S' }, { label: 'Delete selected drawing', key: 'Del' }, { label: 'Show keyboard shortcuts', key: '?' }, { label: 'Close dialogs, cancel drawing, exit chart focus', key: 'Esc' }],
      bUninit: banner === 'uninit', bRpc: rpcDown, bNosol: false,
      pMarkets: s.page === 'markets', pTrade: s.page === 'trade', pPortfolio: s.page === 'portfolio', pVault: s.page === 'vault', pLeaderboard: s.page === 'leaderboard',
      rpcColor: rpcDown ? 'var(--rd)' : 'var(--g)', rpcDot: rpcDown ? this.dot('var(--rd)', false) : this.dot('var(--g)', true), rpcText: rpcDown ? 'Engine unreachable' : 'Connected', slot: rpcDown || !store.slot ? D : K.num(store.slot, 0), latency: rpcDown || store.latencyMs == null ? D : K.num(store.latencyMs, 0),
      sbMarket: m.id, sbPrice: K.num(lp, m.dec), sbAge: stale ? 'stale – trading paused' : `updated ${K.age(ageOf(m))} ago`, sbAgeColor: stale ? 'var(--am)' : 'var(--t3)', clock: new Date(now).toISOString().slice(11, 19),
      toasts, toastBottom: phone ? '76px' : '38px', pagePad: phone ? '16px 12px 24px' : '24px 32px 40px',
    };

    // markets
    const all = K.MARKETS, sumOI = all.reduce((a, x) => a + x.oiL + x.oiS, 0), sumL = all.reduce((a, x) => a + x.oiL, 0), lpct = sumOI ? Math.round(sumL / sumOI * 100) : 50;
    const chgOf = x => (priceOf(x.id) / K.stats(x.id).open - 1) * 100;
    const q = s.q.trim().toLowerCase();
    const keyF = { rank: x => x.rank, chg: chgOf, oi: x => x.oiL + x.oiS, fund: x => x.fund, vol: x => x.vol }[s.sort];
    const mrows = all.filter(x => (s.cat === 'All' || x.cat === s.cat) && (!q || x.id.toLowerCase().includes(q) || x.name.toLowerCase().includes(q))).sort((a, b) => (keyF(a) - keyF(b)) * s.dir).map(x => {
      const S = K.stats(x.id), p = priceOf(x.id), ch = chgOf(x), st = isStale(x), go = side => e => { e && e.stopPropagation(); this.setState({ page: 'trade', market: x.id, preSide: side, phSheet: !!side, side: side || s.side, switcher: false }); };
      return { id: x.id, name: x.name, init: x.b[0], color: x.c, logo: x.logo, pp: K.parts(K.num(p, x.dec)), pbg: flashBg(x.id), cbg: ch >= 0 ? 'var(--gt)' : 'var(--rt)', gid: 'sg-' + x.b, sparkArea: K.spark([...S.spark, p]) + ' 80,24 0,24', volP: K.parts(K.cpt(x.vol)), oiLP: K.parts(K.cpt(x.oiL)), oiSP: K.parts(K.cpt(x.oiS)), max: x.max + '×', status: x.status || '', price: K.num(p, x.dec), pc: flashC(x.id), chg: K.pct(ch), cc: gc(ch), span: S.span, spark: K.spark([...S.spark, p]), oiL: K.cpt(x.oiL), oiS: K.cpt(x.oiS), lf: x.oiL + x.oiS ? x.oiL / (x.oiL + x.oiS) : .5, sf: x.oiL + x.oiS ? x.oiS / (x.oiL + x.oiS) : .5, who: x.fund >= 0 ? 'Longs' : 'Shorts', fund: K.num(Math.abs(x.fund), 4) + '%', vol: K.cpt(x.vol), age: K.age(ageOf(x)), ac: st ? 'var(--am)' : 'var(--t3)', dot: st ? 'var(--am)' : 'var(--g)', open: go(''), long: go('long'), short: go('short') };
    });
    const uninit = banner === 'uninit', noMk = sc === 'nomarkets';
    const mState = loading ? 'loading' : uninit ? 'uninit' : noMk ? 'none' : mrows.length ? 'ok' : 'nomatch';
    const EMPTY = { uninit: ['Protocol not set up', 'Markets will appear once the program is initialized on this network.'], none: ['No markets yet', 'Markets appear here once they are listed.'], nomatch: [`No markets match “${s.q.trim()}”`, 'Try a ticker like SOL or an asset name like Bitcoin.'] };
    const sortArrow = k => s.sort === k ? (s.dir < 0 ? ' ↓' : ' ↑') : '';
    const sortBy = k => () => this.setState(st => ({ sort: k, dir: st.sort === k ? -st.dir : -1 }));
    const mk = {
      mCount: uninit || noMk ? '0' : String(all.length), mOI: uninit || noMk ? D : K.cpt(sumOI), mLS: `${lpct}% / ${100 - lpct}%`, mLp: lpct + '%', mSp: (100 - lpct) + '%', mLf: lpct, mSf: 100 - lpct, mVol: K.cpt(all.reduce((a, x) => a + x.vol, 0)), mNav: K.cpt(K.VAULT.nav), mUtil: K.num(K.VAULT.util, 1) + '%', mUtilW: K.num(K.VAULT.util, 1) + '%',
      cats: ['All', 'Majors', 'Layer 1', 'Layer 2', 'DeFi', 'AI', 'Memes', 'Solana ecosystem'].filter(c => c === 'All' || all.some(x => x.cat === c)).map(c => ({ label: c, n: String(c === 'All' ? all.length : all.filter(x => x.cat === c).length), on: () => this.setState({ cat: c }), bg: s.cat === c ? 'var(--at)' : 'transparent', bd: s.cat === c ? 'var(--a)' : 'var(--l2)', color: s.cat === c ? 'var(--t)' : 'var(--t2)' })),
      q: s.q, onQ: e => this.setState({ q: e.target.value }), clearQ: () => this.setState({ q: '' }),
      mrows, mTable: desktop && mState === 'ok', mCards: phone && mState === 'ok', mLoading: mState === 'loading', mEmpty: ['uninit', 'none', 'nomatch'].includes(mState), mNoMatch: mState === 'nomatch', emptyTitle: (EMPTY[mState] || [])[0] || '', emptyBody: (EMPTY[mState] || [])[1] || '',
      skel: [1, 2, 3, 4, 5, 6, 7, 8].map(i => ({ w1: 90 + (i * 37) % 60 + 'px', w2: 60 + (i * 23) % 40 + 'px' })),
      arrRank: sortArrow('rank'), sortRank: () => this.setState(st => ({ sort: 'rank', dir: st.sort === 'rank' ? -st.dir : 1 })), arrChg: sortArrow('chg'), arrOi: sortArrow('oi'), arrFund: sortArrow('fund'), arrVol: sortArrow('vol'), sortChg: sortBy('chg'), sortOi: sortBy('oi'), sortFund: sortBy('fund'), sortVol: sortBy('vol'),
      sumCols: phone ? 'repeat(2,minmax(0,1fr))' : 'repeat(6,minmax(0,1fr))', searchW: phone ? '100%' : '300px',
    };

    // trade: order form
    const presets = K.PRESETS[m.max], lev = Math.min(s.lev, m.max), last = presets.length - 1;
    const toPos = v => { for (let i = 0; i < last; i++) if (v <= presets[i + 1]) return (i + (v - presets[i]) / (presets[i + 1] - presets[i])) / last * 100; return 100; };
    const fromPos = pp => { const sg = pp / 100 * last, i = Math.min(Math.floor(sg), last - 1), f = sg - i; return Math.max(1, Math.round(presets[i] + f * (presets[i + 1] - presets[i]))); };
    const margin = this.formMargin(), size = margin * lev, fee = size * K.FEE, has = margin > 0, inMode = s.inMode || 'margin';
    const ot = s.otype || 'market', trig = ot === 'limit' || ot === 'stop', pro = false, tif = s.tif || 'gtc', ro = !!s.ro, cross = false, px = this.num(s.px), br = this.borrow();
    const qL = Act.quote(m.index, size, true), qS = Act.quote(m.index, size, false), side0 = s.side === 'short' ? qS : qL, spr = side0 ? side0.spread : K.SPREAD, impact = has && side0 ? size * side0.impact : 0, feeAll = fee + impact + size * spr;
    const refP = trig && px ? px : lp, bP = refP, fixP = ot === 'limit' && px, eL = fixP ? bP : bP * (qL ? qL.price / lp : 1 + K.SPREAD), eS = fixP ? bP : bP * (qS ? qS.price / lp : 1 - K.SPREAD);
    const capL = Act.maxSize(m.index, true), capS = Act.maxSize(m.index, false), liqAt = (sd, e) => has ? K.liqOf({ market: m.id, side: sd, size, entry: e, margin }) : 0;
    const eLev = lev, lqL = liqAt('long', eL), lqS = liqAt('short', eS);
    const reason = side => {
      if (m.status === 'PAUSED') return 'Market paused';
      if (m.status === 'REDUCE-ONLY') return 'Market is reduce-only';
      if (stale) return 'Oracle price is stale';
      if (uninit) return 'Protocol not initialized';
      const L = side === 'long', opp = positions.find(p => p.market === m.id && p.side !== side);
      if (ro && !opp) return `No ${L ? 'short' : 'long'} position to reduce`;
      if (trig) {
        if (!px) return ot === 'limit' ? 'Enter a limit price' : 'Enter a trigger price';
        if (ot === 'limit' && tif === 'post' && (L ? px >= lp : px <= lp)) return `Post only ${side} must be ${L ? 'below' : 'above'} mark`;
        if (ot === 'limit' && tif === 'ioc' && (L ? px < lp * (1 + K.SPREAD) : px > lp * (1 - K.SPREAD))) return `IOC won't fill; ${L ? 'raise' : 'lower'} the price`;
        if (ot === 'stop' && (L ? px <= lp : px >= lp)) return `Stop ${side} must be ${L ? 'above' : 'below'} mark`;
      }
      if (inMode === 'risk' && !(s.tpsl && this.num(s.sl))) return 'Set a stop loss to size by risk';
      if (s.tpsl && s.tpMulti && !pro && !ro) { const e0 = L ? lp : lp; for (const x of (s.tpL || [])) { const xp = this.num(x.p); if (xp && (L ? xp <= e0 : xp >= e0)) return `TP levels must be ${L ? 'above' : 'below'} entry`; } }
      if (!has) return inMode === 'margin' ? 'Enter margin' : 'Enter size';
      if (ro) return size < K.MIN_SIZE ? `Minimum size is ${K.usd(K.MIN_SIZE, 0)}` : '';
      if (margin + fee > s.usdc) return conn && !s.usdc && !positions.length ? 'Deposit USDC to trade' : 'Insufficient USDC';
      if (size < K.MIN_SIZE) return `Minimum size is ${K.usd(K.MIN_SIZE, 0)}`;
      if (1 / lev <= spr + K.FEE + K.MMR) return 'Would be liquidatable immediately; lower leverage';
      const cp = side === 'long' ? capL : capS;
      if (size > cp) return cp < K.MIN_SIZE ? 'No capacity on this side right now' : `Max size on this side now is ${K.cpt(cp)}`;
      if (s.tpsl && !pro) {
        const e = side === 'long' ? eL : eS, tp = this.num(s.tp), sl = this.num(s.sl);
        if (tp && side === 'long' && tp <= e) return 'TP must be above entry';
        if (tp && side === 'short' && tp >= e) return 'TP must be below entry';
        if (sl && side === 'long' && sl >= e) return 'SL must be below entry';
        if (sl && side === 'short' && sl <= e) return 'SL must be above entry';
      }
      return '';
    };
    const rL = reason('long'), rS = reason('short');
    const mine = positions.filter(p => p.market === m.id), hl = mine.find(p => p.side === 'long'), hs = mine.find(p => p.side === 'short');
    const notes = [];
    if (m.status === 'PAUSED') notes.push({ text: 'Market paused', warn: 1 });
    if (m.status === 'REDUCE-ONLY') notes.push({ text: 'Market is reduce-only', warn: 1 });
    if (conn && hl && hs) notes.push({ text: `You hold a Long ${K.num(hl.size, 0)} USD and a Short ${K.num(hs.size, 0)} USD; opening more adds to that side and re-averages its entry` });
    else if (conn && (hl || hs)) { const h = hl || hs; notes.push({ text: `You hold a ${cap(h.side)} ${K.num(h.size, 0)} USD; opening more adds to it and re-averages the entry` }); }
    const tgl = P.orderForm === 'Long/Short toggle' || phone, side1 = s.side === 'short' ? 'short' : 'long', r1 = side1 === 'long' ? rL : rS;
    const ring = sd => s.preSide === sd ? `0 0 0 2px var(--p), 0 0 0 4px ${sd === 'long' ? 'var(--g)' : 'var(--rd)'}` : 'none';
    const maxM = Math.max(0, Math.floor(Math.min(s.usdc / (1 + lev * K.FEE), (side1 === 'long' ? capL : capS) / lev) * 100) / 100);
    const ticks = presets.map((v, i) => ({ label: v + '×', pos: toPos(v), shift: i === 0 ? '0' : i === last ? '-100%' : '-50%', dot: v <= lev ? 'var(--af)' : 'var(--l2)', color: v === lev ? 'var(--a)' : 'var(--t3)', bg: v === lev ? 'var(--at)' : 'var(--r)', bd: v === lev ? 'var(--a)' : 'var(--l)', on: () => this.setState({ lev: v }) }));
    const verb = sd => ro ? `Reduce ${sd === 'long' ? 'Short' : 'Long'}` : `${ot === 'market' ? 'Open' : cap(ot)} ${cap(sd)}`;
    this._rs = { long: rL, short: rS };
    const form = {
      otypes: [['market', 'Market'], ['limit', 'Limit'], ['stop', 'Stop']].map(([id, label]) => { const on = ot === id; return { label, dd: false, rot: 'none', on: () => this.setState({ otype: id, px: id === 'market' || s.px ? s.px : lp.toFixed(m.dec) }), color: on ? 'var(--t)' : 'var(--t3)', bar: on ? 'var(--a)' : 'transparent' }; }),
      pxBid: () => this.setState({ px: (qS ? qS.price : lp).toFixed(m.dec) }), pxAsk: () => this.setState({ px: (qL ? qL.price : lp).toFixed(m.dec) }),
      isLimit: ot === 'limit',
      tifs: [['gtc', 'GTC', 'Good till cancelled'], ['ioc', 'IOC', 'Immediate or cancel'], ['post', 'Post only', 'Never fills immediately']].map(([id, label, tip]) => ({ label, tip, on: () => this.setState({ tif: id }), bg: tif === id ? 'var(--h)' : 'transparent', color: tif === id ? 'var(--t)' : 'var(--t3)', sh: tif === id ? '0 1px 2px rgba(0,0,0,.25)' : 'none' })),
      oneClick: !s.confirmOn,
      mmLiqHint: has ? 'Liq. ' + K.num(side1 === 'long' ? lqL : lqS, m.dec) : '',
      showOpts: true, showTpslOpt: !ro, tpslShow: s.tpsl && !ro, toggleRo: () => this.setState({ ro: !s.ro }), roBg: s.ro ? 'var(--af)' : 'transparent', roBd: s.ro ? 'var(--af)' : 'var(--l2)', roCk: s.ro ? 'var(--ai)' : 'transparent',
      inLabel: inMode === 'margin' ? 'Margin' : inMode === 'risk' ? 'Risk per trade' : 'Size', sumLabel: inMode === 'margin' ? 'Size' : 'Margin',
      inModes: [['margin', 'Margin', 'Enter collateral in USDC'], ['usd', 'USD', 'Enter position size in USD'], ['coin', m.b, `Enter position size in ${m.b}`], ['risk', 'Risk', 'Size the position so a stop-out loses this % of your balance']].map(([id, label, tip]) => { const on = inMode === id; return { label, tip, bg: on ? 'var(--h)' : 'transparent', color: on ? 'var(--t)' : 'var(--t3)', sh: on ? '0 1px 2px rgba(0,0,0,.25)' : 'none', on: () => { if (on) return; this.setState(id === 'risk' ? { inMode: id, sizeIn: '1', tpsl: true, ro: false, sl: s.sl || (lp * (side1 === 'long' ? .98 : 1.02)).toFixed(m.dec), tp: s.tp || (lp * (side1 === 'long' ? 1.04 : .96)).toFixed(m.dec) } : id === 'margin' ? { inMode: id, margin: has ? String(Math.round(margin * 100) / 100) : s.margin } : { inMode: id, sizeIn: has ? (id === 'usd' ? String(Math.round(size * 100) / 100) : (size / refP).toFixed(m.qd)) : '' }); } }; }),
      amtVal: inMode === 'margin' ? s.margin : s.sizeIn, onAmt: e => { const v = e.target.value.replace(/[^0-9.,]/g, ''); this.setState(inMode === 'margin' ? { margin: v } : { sizeIn: v }); },
      riskOn: inMode === 'risk', ...(() => { const r = this.num(s.sizeIn), sl = s.tpsl ? this.num(s.sl) : 0, loss = s.usdc * r / 100, over = has && margin + fee > s.usdc; return { riskText: !sl ? 'Set a stop loss below to size by risk.' : over ? `Risking ${r}% needs more margin than you have; lower the risk or raise leverage.` : `Loses ≈ ${K.usd(loss)} (${r}% of balance) if stopped at ${K.num(sl, m.dec)} · size ${K.usd(size)}`, riskBg: !sl || over ? 'var(--amt)' : 'var(--at)', riskC: !sl || over ? 'var(--am)' : 'var(--t2)' }; })(),
      toggleTpMulti: () => this.setState({ tpMulti: !s.tpMulti, tpL: s.tpL && s.tpL.length ? s.tpL : [{ p: (lp * (side1 === 'long' ? 1.08 : .92)).toFixed(m.dec), q: '50' }] }), tmBg: s.tpMulti ? 'var(--af)' : 'var(--l2)', tmX: s.tpMulti ? 'translateX(11px)' : 'none', tpMulti: !!s.tpMulti,
      tpRows: [{ label: 'TP1', p: s.tp, onP: e => this.setState({ tp: e.target.value }), q: s.tpQ1, onQ: e => this.setState({ tpQ1: e.target.value.replace(/[^0-9.]/g, '') }), canRm: false }].concat((s.tpL || []).map((x, i) => ({ label: 'TP' + (i + 2), p: x.p, q: x.q, canRm: true, onP: e => { const v = e.target.value; this.setState(st => ({ tpL: st.tpL.map((y, j) => j === i ? { ...y, p: v } : y) })); }, onQ: e => { const v = e.target.value.replace(/[^0-9.]/g, ''); this.setState(st => ({ tpL: st.tpL.map((y, j) => j === i ? { ...y, q: v } : y) })); }, rm: () => this.setState(st => ({ tpL: st.tpL.filter((y, j) => j !== i) })) }))),
      tpCanAdd: (s.tpL || []).length < 3, tpAdd: () => this.setState(st => { const l = st.tpL || [], lastP = this.num((l[l.length - 1] || {}).p) || this.num(st.tp) || lp; return { tpL: l.concat([{ p: (lastP * (side1 === 'long' ? 1.03 : .97)).toFixed(m.dec), q: '25' }]) }; }),
      ...(() => { const sum = (this.num(s.tpQ1) || 0) + (s.tpL || []).reduce((a, x) => a + (this.num(x.q) || 0), 0); return { tpNote: sum > 100 ? `Levels add up to ${sum}%; the last closes what's left` : sum < 100 ? `${Math.round(100 - sum)}% left for your stop or manual close` : 'Levels close 100%', tpNoteC: sum > 100 ? 'var(--am)' : 'var(--t3)' }; })(),
      amtUnit: { margin: 'USDC', usd: 'USD', coin: m.b, risk: '% of balance' }[inMode], amtLogo: inMode === 'coin' ? m.logo : '/logos/usdc.png',
      isTrig: trig, pxLabel: ot === 'limit' ? 'Limit price' : 'Trigger price', px: s.px, onPx: e => this.setState({ px: e.target.value.replace(/[^0-9.]/g, '') }), pxMark: () => this.setState({ px: lp.toFixed(m.dec) }),
      pxDist: px ? `${K.pct((px / lp - 1) * 100)} from mark` : `Mark ${K.num(lp, m.dec)}`,
      pxHelp: ot === 'limit' ? { gtc: 'Fills at your price or better and rests until filled or cancelled.', ioc: 'Fills now at your price or better; the rest is cancelled.', post: 'Only rests on the book and never fills on placement. Long below mark, short above.' }[tif] : 'Opens at market once mark crosses the trigger. Long above mark, short below.',
      feeTot: has ? K.usd(feeAll) : D, feesOpen: s.feesOpen, toggleFees: () => this.setState({ feesOpen: !s.feesOpen }), feeRot: s.feesOpen ? 'rotate(180deg)' : 'none',
      feeRows: [{ label: `Open fee · ${K.num(K.FEE * 100, 2)}%`, v: has ? K.usd(fee) : D }, { label: `Spread · ${K.num(spr * 100, 3)}%`, v: has ? K.usd(size * spr) : D }, { label: `Price impact · ${K.num(size && impact ? impact / size * 100 : 0, 3)}%`, v: has ? K.usd(impact) : D }, { label: `Borrow fee · ${K.num(br * 100, 4)}% / 1h`, v: has ? K.usd(size * br) + ' / h' : D }],
      availText: K.num(s.usdc), slipText: s.slip + '%', levLabel: lev + '×', levPct: toPos(lev), levBars: (() => { const NB = 40, lpp = toPos(lev); let cur = 0; for (let i = 0; i < NB; i++) if (i / (NB - 1) * 100 <= lpp + 1e-6) cur = i; return Array.from({ length: NB }, (_, i) => { const on = i <= cur; return { h: (i === cur ? 24 : Math.round(6 + Math.pow(i / (NB - 1), 1.35) * 12)) + 'px', bg: i === cur ? 'var(--t)' : on ? 'var(--a)' : 'var(--l2)', o: i === cur || !on ? 1 : +(0.3 + 0.7 * Math.pow(i / Math.max(cur, 1), 1.3)).toFixed(2) }; }); })(),
      levText: s.levEdit != null ? s.levEdit : String(lev), levW: (String(s.levEdit != null ? s.levEdit : lev).length * 8 + 2) + 'px',
      onLevText: e => { const t = e.target.value.replace(/[^0-9]/g, '').slice(0, 3), v = parseInt(t, 10); this.setState(v ? { levEdit: t, lev: Math.min(m.max, Math.max(1, v)) } : { levEdit: t }); },
      onLevFocus: e => { const el = e.target; this.setState({ levEdit: String(lev) }, () => el.select && el.select()); }, onLevBlur: () => this.setState({ levEdit: null }),
      levDown: () => this.setState({ lev: Math.max(1, lev - 1), levEdit: null }), levUp: () => this.setState({ lev: Math.min(m.max, lev + 1), levEdit: null }),
      liqMove: '≈ ' + K.num(has && eL ? Math.abs(1 - (side1 === 'long' ? lqL / eL : lqS / eS)) * 100 : Math.max(0, (1 / eLev - K.MMR) * 100), eLev >= 50 ? 2 : 1) + '%', levPos: Math.round(toPos(lev) * 10), ticks,
      onLev: e => { const pos = +e.target.value / 10, snap = presets.find(p => Math.abs(toPos(p) - pos) < 1.6); this.setState({ lev: Math.min(m.max, snap || fromPos(pos)), levEdit: null }); },
      margin: s.margin, onMargin: e => this.setState({ margin: e.target.value.replace(/[^0-9.,]/g, '') }),
      pcts: inMode === 'risk' ? [0.5, 1, 2, 5].map(v => { const on = this.num(s.sizeIn) === v; return { label: v + '%', on: () => this.setState({ sizeIn: String(v) }), bg: on ? 'var(--at)' : 'var(--r)', bd: on ? 'var(--a)' : 'var(--l)', color: on ? 'var(--t)' : 'var(--t2)' }; }) : [10, 25, 50, 'Max'].map(p => { const v = p === 'Max' ? maxM : Math.floor(maxM * p) / 100, act = has && Math.abs(margin - v) < 0.005; return { label: p === 'Max' ? 'Max' : p + '%', on: () => this.setState(inMode === 'margin' ? { margin: String(v) } : { sizeIn: inMode === 'usd' ? String(Math.floor(v * lev * 100) / 100) : (v * lev / refP).toFixed(m.qd) }), bg: act ? 'var(--at)' : 'var(--r)', bd: act ? 'var(--a)' : 'var(--l)', color: act ? 'var(--t)' : 'var(--t2)' }; }),
      sizeMain: inMode !== 'margin' ? K.usd(margin) : s.unit === 'usd' ? K.usd(size) : `${K.num(size / lp, m.qd)} ${m.b}`, sizeAlt: inMode === 'usd' ? `${lev}× · ≈ ${K.num(size / refP, m.qd)} ${m.b}` : inMode === 'coin' ? `${lev}× · ≈ ${K.usd(size)}` : s.unit === 'usd' ? `≈ ${K.num(size / lp, m.qd)} ${m.b}` : `≈ ${K.usd(size)}`,
      tpsl: s.tpsl, toggleTpsl: () => this.setState({ tpsl: !s.tpsl, tp: s.tp || (lp * 1.05).toFixed(m.dec), sl: s.sl || (lp * 0.97).toFixed(m.dec) }), tpslBg: s.tpsl ? 'var(--af)' : 'transparent', tpslBd: s.tpsl ? 'var(--af)' : 'var(--l2)', tpslCk: s.tpsl ? 'var(--ai)' : 'transparent',
      tp: s.tp, sl: s.sl, onTp: e => this.setState({ tp: e.target.value }), onSl: e => this.setState({ sl: e.target.value }),
      quoteRows: [
        { label: 'Est. entry', l: has ? K.num(eL, m.dec) : D, s: has ? K.num(eS, m.dec) : D },
        { label: 'Liq. price', l: has ? K.num(lqL, m.dec) : D, s: has ? K.num(lqS, m.dec) : D },
        { label: 'Cost', l: has ? K.usd(margin + fee) : D, s: has ? K.usd(margin + fee) : D },
        { label: 'Max size', l: K.cpt(capL), s: K.cpt(capS) },
      ],
      q1Rows: [
        { label: 'Est. entry', v: has ? K.num(side1 === 'long' ? eL : eS, m.dec) : D },
        { label: 'Liq. price', v: has ? K.num(side1 === 'long' ? lqL : lqS, m.dec) : D },
        { label: 'Cost', v: has ? K.usd(margin + fee) : D },
        { label: 'Max size', v: K.cpt(side1 === 'long' ? capL : capS) },
      ],
      notes: notes.map(n => ({ text: n.text, bg: n.warn ? 'var(--amt)' : 'var(--at)', color: n.warn ? 'var(--am)' : 'var(--t2)', ic: n.warn ? 'var(--am)' : 'var(--a)' })),
      dual: !tgl, tgl, fConn: conn, fDisc: !conn,
      longOk: !rL, longNo: !!rL, longReason: rL, shortOk: !rS, shortNo: !!rS, shortReason: rS, longRing: ring('long'), shortRing: ring('short'),
      openLong: () => this.request('long'), openShort: () => this.request('short'),
      sideTabs: ['long', 'short'].map(sd => ({ label: cap(sd), on: () => this.setState({ side: sd }), bg: side1 === sd ? (sd === 'long' ? 'var(--gf)' : 'var(--rf)') : 'transparent', color: side1 === sd ? (sd === 'long' ? 'var(--gi)' : 'var(--ri)') : 'var(--t2)' })),
      oneOk: !r1, oneNo: !!r1, oneReason: r1, oneLabel: verb(side1), longLabel: verb('long'), shortLabel: verb('short'), oneBg: side1 === 'long' ? 'var(--gf)' : 'var(--rf)', oneInk: side1 === 'long' ? 'var(--gi)' : 'var(--ri)', openOne: () => { if (phone) this.setState({ phSheet: false }); this.request(side1); },
      settingsOpen: s.settings, toggleSettings: () => this.setState({ settings: !s.settings }), settingsBg: s.settings ? 'var(--h)' : 'transparent',
      slips: [0.5, 1, 2].map(v => ({ label: v + '%', on: () => this.setState({ slip: v }), bg: s.slip === v ? 'var(--h)' : 'transparent', color: s.slip === v ? 'var(--t)' : 'var(--t3)' })),
      confBg: !s.confirmOn ? 'var(--af)' : 'var(--l2)', confX: !s.confirmOn ? 'translateX(14px)' : 'translateX(0)', toggleConfirmOn: () => this.setState({ confirmOn: !s.confirmOn }),
      units: [['usd', 'USD'], ['asset', m.b]].map(([id, label]) => ({ label, on: () => this.setState({ unit: id }), bg: s.unit === id ? 'var(--h)' : 'transparent', color: s.unit === id ? 'var(--t)' : 'var(--t3)' })),
      unitLabel: s.unit === 'usd' ? 'USD' : m.b, flipUnit: () => this.setState({ unit: s.unit === 'usd' ? 'asset' : 'usd' }),
      account: [{ label: 'Equity', value: conn ? K.usd(equity) : D, color: 'var(--t)' }, { label: 'Available', value: conn ? K.usd(s.usdc) : D, color: 'var(--t)' }, { label: 'Margin used', value: conn ? K.usd(used) : D, color: 'var(--t)' }, { label: 'Unrealized PnL', value: conn ? K.sUsd(upnl) : D, color: conn ? gc(upnl) : 'var(--t)' }].map(a => ({ ...a, v: K.parts(a.value) })),
    };

    // confirm dialog
    const cs = s.confirm || 'long', worst = cs === 'long' ? lp * (1 + s.slip / 100) : lp * (1 - s.slip / 100);
    const cfRows = [
      { label: 'Margin', value: `${K.num(margin)} USDC` }, { label: 'Margin mode', value: 'Isolated' }, ...(ro ? [{ label: 'Reduce only', value: 'Yes' }] : []), ...(ot === 'limit' ? [{ label: 'Time in force', value: { gtc: 'Good till cancelled', ioc: 'Immediate or cancel', post: 'Post only' }[tif] }] : []), ...(s.tpsl && s.tpMulti && !ro ? [{ label: 'TP levels', value: String(1 + (s.tpL || []).length) }] : []), { label: 'Est. entry', value: K.num(cs === 'long' ? eL : eS, m.dec) }, ...(trig ? [{ label: ot === 'limit' ? 'Limit price' : 'Trigger price', value: K.num(px, m.dec) }] : [{ label: `Worst fill at ${s.slip}% slippage`, value: K.num(worst, m.dec) }]),
      { label: 'Liquidation price', value: K.num(cs === 'long' ? lqL : lqS, m.dec), color: 'var(--am)' }, { label: `Open fee (${K.num(K.FEE * 100, 2)}%)`, value: `${K.num(fee)} USDC` }, { label: 'Spread and impact', value: `${K.num(size * spr + impact)} USDC` }, { label: 'Borrow fee', value: `${K.num(br * 100, 4)}% / 1h` },
      ...(s.tpsl && this.num(s.tp) ? [{ label: 'Take profit', value: K.num(this.num(s.tp), m.dec) }] : []), ...(s.tpsl && this.num(s.sl) ? [{ label: 'Stop loss', value: K.num(this.num(s.sl), m.dec) }] : []),
      { label: 'Max profit', value: K.usd(size) },
    ].map(r => ({ ...r, color: r.color || 'var(--t)' }));
    const cf = {
      cfOpen: !!s.confirm, cfMarket: m.id, cfTitle: `${verb(cs)} · ${lev}×`, cfColor: cs === 'long' ? 'var(--g)' : 'var(--rd)', cfTint: cs === 'long' ? 'var(--gt)' : 'var(--rt)', cfSize: K.usd(size), cfAsset: `≈ ${K.num(size / lp, m.qd)} ${m.b}`, cfRows,
      cfBg: cs === 'long' ? 'var(--gf)' : 'var(--rf)', cfInk: cs === 'long' ? 'var(--gi)' : 'var(--ri)', cfCancel: () => this.setState({ confirm: null, dontAsk: false }), cfConfirm: () => this.open(cs),
      toggleDontAsk: () => this.setState({ dontAsk: !s.dontAsk }), daBg: s.dontAsk ? 'var(--af)' : 'transparent', daBd: s.dontAsk ? 'var(--af)' : 'var(--l2)', daCk: s.dontAsk ? 'var(--ai)' : 'transparent',
    };

    // trade: ticker, chart, trades, layout
    const S24 = K.stats(m.id), ch24 = lp - S24.open;
    const lines = [];
    const dg = s.lineDrag, hd = s.lineHold && s.lineHold.until > now ? s.lineHold : null, lk = (key, p) => dg && dg.key === key ? dg.p : hd && hd.key === key ? hd.p : p;
    if (conn) {
      mine.forEach(p => { const L = cap(p.side), col = p.side === 'long' ? 'var(--g)' : 'var(--rd)'; lines.push({ p: p.entry, label: `${L} entry`, col }); lines.push({ p: this.liq(p), label: `${L} liq.`, col: 'var(--am)' });
        ['tp', 'sl'].forEach(k => { if (!p[k]) return; const key = k + p.id, pr = lk(key, p[k]); lines.push({ key, kind: k, pid: p.id, market: p.market, p: pr, p0: p[k], label: `${L} ${k.toUpperCase()}`, col: k === 'tp' ? 'var(--g)' : 'var(--rd)', drag: 1, est: dg && dg.key === key ? K.sUsd(K.pnlOf(p, pr)) : '', x: () => this.clearTrig(p, k) }); }); });
      s.orders.filter(o => o.market === m.id).forEach(o => { const key = 'o' + o.id, pr = lk(key, o.price); lines.push({ key, kind: 'order', oid: o.id, market: o.market, p: pr, p0: o.price, label: o.ro ? `${o.label} ${o.full ? 'rest' : K.cpt(o.size)}` : `${o.label} ${cap(o.side)} ${K.cpt(o.size)}`, col: o.kind === 3 ? 'var(--g)' : o.kind === 4 ? 'var(--rd)' : 'var(--a)', drag: 1, mini: false, noTag: false, est: dg && dg.key === key ? K.pct((pr / lp - 1) * 100) : '', x: () => this.cancelOrder(o) }); });
    }
    (s.alerts || []).filter(a => a.market === m.id).forEach(a => { const key = 'al' + a.id, pr = lk(key, a.price); lines.push({ key, kind: 'alert', aid: a.id, market: a.market, p: pr, p0: a.price, label: 'Alert', col: 'var(--t2)', drag: 1, bell: 1, est: dg && dg.key === key ? K.pct((pr / lp - 1) * 100) : '', x: () => this.removeAlert(a) }); });
    const C = K.chart(m.id, s.tf, lp, lines, stale, { count: s.view.count, end: s.view.end, type: s.ctype, ind: {}, inds: this.indList() });
    const ph = Math.max(40, (s.plotH || 400) - 44);
    const stackLbl = arr => { const out = arr.map(o => ({ ...o, px: parseFloat(o.top) / 100 * ph })).sort((a, b) => a.px - b.px); let lane = [], k; out.forEach(o => { lane = lane.filter(q => o.px - q.px < 20); k = 0; while (lane.some(q => q.k === k)) k++; o.k = k; o.rx = (8 + k * 136) + 'px'; lane.push(o); }); return out; };
    const hov = s.hx != null && s.hx >= 0 && s.hx <= 1, hi = hov ? Math.min(C.n - 1, Math.max(0, Math.floor(s.hx * C.slots))) : C.n - 1, cd = C.cs[hi], cchg = (cd.c / cd.o - 1) * 100;
    const chartEmpty = sc === 'empty', chartLoading = loading, chartOk = !chartEmpty && !chartLoading;
    const iv = C.at(hi), TFms = K.TF[s.tf] * 1000; this.cur = { C: C, TFms: TFms };
    const xP = t => (((t - C.t0) / TFms) - C.start + .5) / C.slots * 100, yP = p => (C.hi - p) / (C.hi - C.lo) * 100, P2 = v => v.toFixed(2);
    let dLine = '', dFill = '', dFib = '', dMeasF = '', dMeasL = '', dMeasC = 'var(--g)'; const dDots = [], dLabels = [], dFibs = [];
    const PW = s.plotW || 800, PH = Math.max(40, (s.plotH || 400) - 44), Xd = t2 => ((((t2 - C.t0) / TFms) - C.start + .5) / C.slots) * PW, Yd = p => (C.hi - p) / (C.hi - C.lo) * PH, fmtD = v => K.num(v, m.dec), tlD = t2 => C.tl(t2);
    const dShapes = []; let dsBar = null; const savedD = s.drawings[m.id] || [];
    const drs = savedD.concat(s.draft && s.draft.type !== 'measure' ? [{ ...s.draft, st: s.drawStyle }] : []);
    if (!s.hideDraw && chartOk) drs.forEach((d, di) => {
      if (!d.a) return; const isDraft = di >= savedD.length, sel = di === s.selDraw && !isDraft, g = this.drawGeom(d, Xd, Yd, PW, PH, fmtD, tlD, sel);
      g.paths.forEach(q => dShapes.push({ ...q, so: q.so != null ? q.so : 1, dash: q.dash || 'none' }));
      g.labels.forEach(l => dLabels.push(l));
      if (sel || isDraft) g.handles.forEach(h => dDots.push({ x: h.x.toFixed(1) + 'px', y: h.y.toFixed(1) + 'px' }));
      if (sel) { const ys = g.handles.map(h => h.y).concat(g.segs.flatMap(q => [q[1], q[3]])).concat(g.areas.map(q => q[1])).filter(v => v > -20 && v < PH + 20), xs = g.handles.map(h => h.x).concat(g.segs.flatMap(q => [q[0], q[2]])).concat(g.areas.flatMap(q => [q[0], q[2]])).filter(v => v > -20 && v < PW + 20); dsBar = { d, di, x: Math.max(210, Math.min(PW - 210, xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : PW / 2)), y: Math.max(52, ys.length ? Math.min(...ys) : PH / 2) }; }
    });
    const DNAME = { trend: 'Trend line', ray: 'Ray', ext: 'Extended line', hline: 'Horizontal line', vline: 'Vertical line', arrow: 'Arrow', channel: 'Parallel channel', rect: 'Rectangle', circle: 'Ellipse', brush: 'Brush', fib: 'Fib retracement', fibext: 'Fib extension', pitch: 'Pitchfork', prange: 'Price range', drange: 'Date range', long: 'Long position', short: 'Short position', text: 'Text note' };
    const updD = patch => this.setState(st => { const cur = (st.drawings[st.market] || []).slice(), i = st.selDraw; if (cur[i] == null) return null; const nd = { ...cur[i], ...(typeof patch === 'function' ? patch(cur[i]) : patch) }; cur[i] = nd; return { drawings: { ...st.drawings, [st.market]: cur }, drawStyle: nd.st }; });
    const dsd = dsBar && dsBar.d, dst = (dsd && dsd.st) || {}, dsv = dsBar ? {
      dsOn: true, dsX: dsBar.x.toFixed(0) + 'px', dsY: dsBar.y.toFixed(0) + 'px', dsName: DNAME[dsd.type] || 'Drawing', dsStyle: !['long', 'short', 'fib', 'fibext'].includes(dsd.type), dsIsText: dsd.type === 'text', dsText: dsd.text || '', onDsText: e => updD({ text: e.target.value.slice(0, 60) }),
      dsSw: ['var(--a)', '#F0B90B', '#7CD992', '#F6465D', '#E056FD', '#3DC7F5', '#E5E7EB'].map(c => ({ c, ring: (dst.c || 'var(--a)') === c ? '0 0 0 2px var(--p), 0 0 0 3.5px ' + c : 'none', on: () => updD(x => ({ st: { ...(x.st || {}), c } })) })),
      dsWs: [[1, 'Thin'], [1.6, 'Medium'], [2.6, 'Thick']].map(([w, tip]) => { const on = Math.abs((dst.w || 1.6) - w) < .3; return { tip, h: w + 'px', bg: on ? 'var(--h)' : 'transparent', fg: on ? 'var(--t)' : 'var(--t3)', on: () => updD(x => ({ st: { ...(x.st || {}), w } })) }; }),
      dsDs: [['solid', 'Solid', 'M3 12h18'], ['dash', 'Dashed', 'M3 12h5M10 12h4M16 12h5'], ['dot', 'Dotted', 'M4 12h.01M8 12h.01M12 12h.01M16 12h.01M20 12h.01']].map(([k, tip, dd]) => { const on = (dst.dash || 'solid') === k; return { tip, d: dd, bg: on ? 'var(--h)' : 'transparent', fg: on ? 'var(--t)' : 'var(--t3)', on: () => updD(x => ({ st: { ...(x.st || {}), dash: k } })) }; }),
      dsDel: () => this.delDrawing(dsBar.di), dsClose: () => this.setState({ selDraw: null }),
      dsDup: () => this.setState(st => { const cur = (st.drawings[st.market] || []).slice(), o = cur[st.selDraw]; if (!o) return null; const off = (C.hi - C.lo) * .04, sh = q => q && { t: q.t, p: q.p - off }; cur.push({ ...o, a: sh(o.a), b: sh(o.b), c: sh(o.c), pts: o.pts && o.pts.map(sh), s: o.s != null ? o.s - off : o.s }); return { drawings: { ...st.drawings, [st.market]: cur }, selDraw: cur.length - 1 }; }),
    } : { dsOn: false };
    const ms = s.draft && s.draft.type === 'measure' ? s.draft : s.measure;
    if (ms && ms.b && chartOk) { const a = { x: xP(ms.a.t), y: yP(ms.a.p) }, b = { x: xP(ms.b.t), y: yP(ms.b.p) }, x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x), y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y), dp = ms.b.p - ms.a.p, upM = dp >= 0, bars = Math.round((ms.b.t - ms.a.t) / TFms); dMeasC = upM ? 'var(--g)' : 'var(--rd)'; dMeasF = 'M' + P2(x1) + ' ' + P2(y1) + 'H' + P2(x2) + 'V' + P2(y2) + 'H' + P2(x1) + 'Z'; dMeasL = dMeasF + 'M' + P2((x1 + x2) / 2) + ' ' + P2(a.y) + 'V' + P2(b.y); dLabels.push({ x: P2((x1 + x2) / 2) + '%', y: P2(upM ? y1 : y2) + '%', tf: upM ? 'translate(-50%,calc(-100% - 6px))' : 'translate(-50%,6px)', text: (upM ? '+' : '−') + K.num(Math.abs(dp), m.dec) + '   ' + K.pct(dp / ms.a.p * 100) + '   ' + Math.abs(bars) + ' bars', bg: upM ? 'var(--gf)' : 'var(--rf)', ink: upM ? 'var(--gi)' : 'var(--ri)' }); }
    const IND = K.IND, iList = this.indList(), gi = Math.min(C.end, C.start + hi), cwI = 1000 / C.slots, XI = i => ((i - C.start + .5) * cwI).toFixed(1);
    const fmtI = (t2, v) => v == null ? '—' : ['rsi', 'kdj', 'stochrsi'].includes(t2) ? K.num(v, 2) : t2 === 'vol' ? K.cpt(v) : K.num(v, m.dec);
    const serI = (a, Y) => { let dd = '', pen = false; for (let i = C.start; i <= C.end; i++) { const v = a[i]; if (v == null) { pen = false; continue; } dd += (pen ? 'L' : 'M') + XI(i) + ' ' + Y(v).toFixed(1); pen = true; } return dd; };
    const lblI = q => { if (q.t === 'vol') return +q.p.len > 0 ? 'VOL · MA ' + q.p.len : 'VOL'; const D = IND[q.t], nums = D.params.filter(x => x[0] !== 'src').map(x => q.p[x[0]]); return D.short + (nums.length ? '(' + nums.join(',') + ')' : '') + (q.p.src && q.p.src !== 'close' ? ' ' + q.p.src : ''); };
    const actI = q => ({ gear: () => this.setState({ indEdit: q.id, indPick: false }), eye: () => this.indPatch(q.id, x => ({ hidden: !x.hidden })), eyeTip: q.hidden ? 'Show' : 'Hide', eyeD: q.hidden ? 'M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12zM4 4l16 16' : 'M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12zM12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5', x: () => this.indRemove(q.id), op: q.hidden ? .45 : 1 });
    const YM = v => 400 * (1 - (v - C.lo) / (C.hi - C.lo)), ovPaths = [], qChips = [], mRows = [], panes = [];
    let volOn = false;
    iList.forEach((q, qi) => {
      const D = IND[q.t]; if (!D) return; const r = (C.indv && C.indv[qi]) || {}, col = k => q.c[k] || 'var(--t2)', wd = k => q.w[k] || 1.3;
      if (D.pane === 'main') {
        if (q.t === 'vol') { volOn = !q.hidden; if (!q.hidden && r.ma) ovPaths.push({ d: serI(r.ma, v => 400 - v / (C.vmax || 1) * 400 * .18), c: col(0), w: wd(0), fill: 'none', fo: 0, cap: 'butt' }); mRows.push({ label: lblI(q), col: 'var(--t2)', vals: [{ v: fmtI('vol', chartOk && C.cs[hi] ? C.cs[hi].v : null), c: 'var(--t2)' }].concat(r.ma ? [{ v: 'MA ' + fmtI('vol', r.ma[gi]), c: col(0) }] : []), ...actI(q) }); return; }
        if (!q.hidden && chartOk) {
          if (q.t === 'bb') { const pts = []; for (let i = C.start; i <= C.end; i++) if (r.u[i] != null) pts.push([XI(i), YM(r.u[i]).toFixed(1), YM(r.l[i]).toFixed(1)]); if (pts.length > 1) ovPaths.push({ d: 'M' + pts.map(x => x[0] + ' ' + x[1]).join('L') + 'L' + pts.slice().reverse().map(x => x[0] + ' ' + x[2]).join('L') + 'Z', c: 'none', w: 0, fill: col(0), fo: .06, cap: 'butt' }); }
          if (q.t === 'sar') { let dd = ''; for (let i = C.start; i <= C.end; i++) if (r.v[i] != null) dd += 'M' + XI(i) + ' ' + YM(r.v[i]).toFixed(1) + 'h0'; ovPaths.push({ d: dd, c: col(0), w: wd(0), fill: 'none', fo: 0, cap: 'round' }); }
          else D.lines.forEach(([k], li) => { if (r[k]) ovPaths.push({ d: serI(r[k], YM), c: col(li), w: wd(li), fill: 'none', fo: 0, cap: 'butt' }); });
        }
        const vals = D.lines.map(([k], li) => ({ v: fmtI(q.t, r[k] ? r[k][gi] : null), c: col(li) }));
        if (q.t === 'ma' || q.t === 'ema') qChips.push({ label: lblI(q), value: vals[0].v, col: col(0), tip: lblI(q) + ' · click for settings', op: q.hidden ? .45 : 1, gear: actI(q).gear });
        else mRows.push({ label: lblI(q), col: col(0), vals, ...actI(q) });
        return;
      }
      // sub pane
      let lo = Infinity, hi2 = -Infinity; D.lines.forEach(([k]) => { const a = r[k]; if (a) for (let i = C.start; i <= C.end; i++) if (a[i] != null) { lo = Math.min(lo, a[i]); hi2 = Math.max(hi2, a[i]); } });
      if (!Number.isFinite(lo)) { lo = 0; hi2 = 1; }
      if (D.fixed) { lo = Math.min(lo, D.fixed[0]); hi2 = Math.max(hi2, D.fixed[1]); } else { if (D.zero) { lo = Math.min(lo, 0); hi2 = Math.max(hi2, 0); } const pd = (hi2 - lo) * .08 || Math.abs(hi2) * .1 || 1; lo -= pd; hi2 += pd; }
      const YS = v => 100 * (1 - (v - lo) / (hi2 - lo)), yPct = v => (8 + YS(v) / 100 * 0).toFixed(1), paths = [], hPx = Math.round(q.h || 96), inner = Math.max(10, hPx - 16), topPx = v => (8 + YS(v) / 100 * inner).toFixed(1) + 'px';
      if (!q.hidden && chartOk) {
        if (q.t === 'macd' && r.h) { const bw = cwI * .6; let hu = '', hd = ''; for (let i = C.start; i <= C.end; i++) { const v = r.h[i]; if (v == null) continue; const x = (i - C.start + .5) * cwI, y0 = YS(0), y1 = YS(v), bar = 'M' + (x - bw / 2).toFixed(1) + ' ' + Math.min(y0, y1).toFixed(2) + 'H' + (x + bw / 2).toFixed(1) + 'V' + Math.max(y0, y1, Math.min(y0, y1) + .3).toFixed(2) + 'H' + (x - bw / 2).toFixed(1) + 'Z'; if (v >= 0) hu += bar; else hd += bar; } paths.push({ d: hu, c: 'none', w: 0, fill: 'var(--g)', fo: .55 }, { d: hd, c: 'none', w: 0, fill: 'var(--rd)', fo: .55 }); }
        D.lines.forEach(([k], li) => { if (r[k] && q.c[li]) paths.push({ d: serI(r[k], YS), c: col(li), w: wd(li), fill: 'none', fo: 0 }); });
      }
      const lv = (D.levels || []).concat(D.zero ? [0] : []);
      const vals = D.lines.map(([k], li) => ({ v: (li === 2 && q.t === 'macd' ? '' : '') + fmtI(q.t, r[k] ? r[k][gi] : null), c: q.c[li] || (r.h && r.h[gi] >= 0 ? 'var(--g)' : 'var(--rd)') }));
      const last = D.lines.map(([k], li) => ({ k, li, v: r[k] ? r[k][gi] : null })).filter(x => x.v != null && q.c[x.li]);
      panes.push({ id: q.id, h: hPx + 'px', label: lblI(q), vals, ...actI(q), drag: e => this.paneDown(e, q),
        bands: D.levels ? [{ t: topPx(D.levels[0]), h: (YS(D.levels[1]) - YS(D.levels[0])) / 100 * inner + 'px' }] : [],
        levels: lv.map(v => ({ y: topPx(v) })),
        ax: (D.fixed ? lv : [hi2 - (hi2 - lo) * .1, lo + (hi2 - lo) * .1].concat(D.zero ? [0] : [])).filter(v => !last.some(x => Math.abs(YS(x.v) - YS(v)) / 100 * inner < 14)).map(v => ({ y: topPx(v), label: fmtI(q.t, v) })),
        tags: q.hidden || !chartOk ? [] : last.slice(0, 1).map(x => ({ y: topPx(x.v), v: fmtI(q.t, x.v), c: q.c[x.li] })), paths });
    });
    const offMk = (arr, up, nMax) => { const a2 = arr.filter(l => !l.noTag).sort((p, q) => up ? p.p - q.p : q.p - p.p); return a2.slice(0, nMax).map(l => ({ text: l.label + ' ' + l.price, c: l.col, d: up ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6' })).concat(a2.length > nMax ? [{ text: '+' + (a2.length - nMax) + ' more', c: 'var(--t3)', d: up ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6' }] : []); };
    const offN = (s.plotH || 400) < 300 || (s.plotW || 800) < 520 ? 1 : 2, offTop = chartOk ? offMk(C.pinsTop, true, offN) : [], offBot = chartOk ? offMk(C.pinsBot, false, offN) : [];
    const AH = Math.max(40, s.plotH || 400), aph = Math.max(40, AH - 44), axTags = [];
    if (chartOk) {
      const G = 19, ptp = C.pinsTop.filter(l => !l.noTag).sort((p, q) => q.p - p.p), pbt = C.pinsBot.filter(l => !l.noTag).sort((p, q) => q.p - p.p), mid = [];
      if (0) ptp.forEach((l, i) => axTags.push({ yy: 10 + i * G, text: '▲' + l.price, label: l.label, bg: 'var(--p)', ink: l.col, bd: l.col, z: 2, ln: l.drag ? l : null }));
      if (0) pbt.forEach((l, i) => axTags.push({ yy: AH - 10 - (pbt.length - 1 - i) * G, text: '▼' + l.price, label: l.label, bg: 'var(--p)', ink: l.col, bd: l.col, z: 2, ln: l.drag ? l : null }));
      C.inl.filter(l => !l.noTag).forEach(l => mid.push({ want: 28 + parseFloat(l.top) / 100 * aph, text: l.price, label: l.label, bg: 'var(--p)', ink: l.col, bd: l.col, z: 2, ln: l.drag ? l : null }));
      if (s.pyth || s.ref) { const tb = s.pyth ? 'var(--af)' : C.lastUp ? 'var(--gf)' : 'var(--rf)'; mid.push({ want: 28 + parseFloat(C.lastTop) / 100 * aph, text: K.num(lp, m.dec), label: 'Mark price', bg: tb, bd: tb, ink: s.pyth ? 'var(--ai)' : C.lastUp ? 'var(--gi)' : 'var(--ri)', z: 3 }); }
      mid.sort((p, q) => p.want - q.want);
      const bandLo = 10, bandHi = AH - 10;
      mid.forEach((t, i) => { t.yy = Math.max(t.want, i ? mid[i - 1].yy + G : bandLo); });
      for (let i = mid.length - 1; i >= 0; i--) mid[i].yy = Math.min(mid[i].yy, i < mid.length - 1 ? mid[i + 1].yy - G : bandHi);
      mid.forEach(t => { t.yy = Math.max(bandLo, t.yy); axTags.push(t); });
      axTags.forEach(t => { t.y = Math.round(Math.max(10, Math.min(AH - 10, t.yy))) + 'px'; t.down = t.ln ? e => this.lineDown(e, t.ln) : undefined; t.cur = t.ln ? 'ns-resize' : 'default'; t.pe = t.ln ? 'auto' : 'none'; t.tip = t.ln ? t.label + ' · drag to move' : t.label; });
    }
    const fl = P.layout === 'Form left';
    const side3 = wide, trWx = s.trW, bookOver = desktop && !wide && !!s.bookOver;
    const areas = fl ? (side3 ? '"tk tk tk" "of ch tr" "of bp bp"' : '"tk tk" "of ch" "of bp"') : (side3 ? '"tk tk tk" "ch tr of" "bp bp of"' : '"tk tk" "ch of" "bp of"');
    const cols = fl ? (side3 ? `${s.ofW}px minmax(0,1fr) ${trWx}px` : `${s.ofW}px minmax(0,1fr)`) : (side3 ? `minmax(0,1fr) ${trWx}px ${s.ofW}px` : `minmax(0,1fr) ${s.ofW}px`);
    const swq = s.swq.trim().toLowerCase();
    const trs = chartEmpty || loading ? [] : K.trades(m.id).map(t => ({ price: K.num(t.p, m.dec), color: t.buy ? 'var(--g)' : 'var(--rd)', size: s.unit === 'usd' ? K.num(t.usd, 0) : K.num(t.usd / t.p, m.qd), time: K.hms(t.t), href: K.txUrl(t.sig) }));
    const bk = (() => {
      const tab = s.bkTab || 'book', b = Math.pow(10, Math.floor(Math.log10(lp)) - 4), opts = [1, 5, 10, 50].map(x => +(x * b).toPrecision(6)), tick = opts[(s.bkTi || 0) % 4], dp = Math.max(0, Math.round(-Math.log10(tick) + (tick / Math.pow(10, Math.floor(Math.log10(tick))) === 5 ? 0 : 0)));
      const tabs = [...(bookOver ? [['chart', 'Chart']] : []), ['book', 'Order book'], ['trades', 'Trades']].map(([id, label]) => ({ label, on: () => this.setState(id === 'chart' ? { bookOver: false } : { bkTab: id }), color: tab === id ? 'var(--t)' : 'var(--t3)', bar: tab === id ? 'var(--a)' : 'transparent' }));
      if (tab !== 'book' || chartEmpty || loading) return { bkTabs: tabs, bkOn: tab === 'book', trOn: tab === 'trades', bkAsks: [], bkBids: [], bkTick: K.num(tick, dp), bkTickNext: () => this.setState({ bkTi: ((s.bkTi || 0) + 1) % 4 }), bkMid: D, bkMidC: 'var(--t)', bkSpread: D, bkBidF: 1, bkAskF: 1, bkBidP: D, bkAskP: D, bkLeave: () => {} };
      // best quotes are for the smallest order: they include impact whenever the skew already leans that way
      const qa = Act.quote(m.index, K.MIN_SIZE, true), qb = Act.quote(m.index, K.MIN_SIZE, false), ask1 = qa ? qa.price : lp * (1 + K.SPREAD), bid1 = qb ? qb.price : lp * (1 - K.SPREAD), N = 16;
      const ask0 = Math.ceil(ask1 / tick) * tick, bid0 = Math.floor(bid1 / tick) * tick;
      const A = Act.ladder(m.index, true, Array.from({ length: N }, (_, i) => ask0 + i * tick)), B = Act.ladder(m.index, false, Array.from({ length: N }, (_, i) => bid0 - i * tick));
      if (!A.length || !B.length) return { bkTabs: tabs, bkOn: true, trOn: false, bkAsks: [], bkBids: [], bkTick: K.num(tick, dp), bkTickNext: () => this.setState({ bkTi: ((s.bkTi || 0) + 1) % 4 }), bkMid: D, bkMidC: 'var(--t)', bkSpread: D, bkBidF: 1, bkAskF: 1, bkBidP: D, bkAskP: D, bkLeave: () => {} };
      const mx = Math.max(A[9].cum, B[9].cum) || 1, hv = s.bkHov;
      const fmt = (usd, p) => s.unit === 'usd' ? K.cpt(usd).replace('$', '') : K.num(usd / p, m.qd);
      const row = (side, l, i) => { const inRange = hv && hv.s === side && i <= hv.i; return { price: K.num(l.p, dp), size: l.usd < .5 ? '—' : fmt(l.usd, l.p), total: fmt(l.cum, l.p), w: Math.min(100, l.cum / mx * 100).toFixed(1) + '%', hl: inRange ? 'var(--h)' : 'transparent', hov: () => (!hv || hv.s !== side || hv.i !== i) && this.setState({ bkHov: { s: side, i } }), pick: () => this.setState({ otype: s.otype === 'stop' ? 'stop' : 'limit', px: l.p.toFixed(Math.max(dp, m.dec)) }) }; };
      const bT = B.slice(0, 10).reduce((a, l) => a + l.usd, 0), aT = A.slice(0, 10).reduce((a, l) => a + l.usd, 0), dir = K.live.dir[m.id];
      return { bkTabs: tabs, bkOn: true, trOn: false, bkTick: K.num(tick, dp), bkTickNext: () => this.setState({ bkTi: ((s.bkTi || 0) + 1) % 4 }),
        bkAsks: A.map((l, i) => row('a', l, i)).reverse(), bkBids: B.map((l, i) => row('b', l, i)), bkLeave: () => s.bkHov && this.setState({ bkHov: null }),
        bkMid: K.num(lp, m.dec), bkMidC: staleAll ? 'var(--t)' : dir < 0 ? 'var(--rd)' : 'var(--g)', bkMidRot: dir < 0 ? 'rotate(180deg)' : 'none', bkSpread: K.num(ask1 - bid1, m.dec) + ' · ' + K.num((ask1 - bid1) / lp * 100, 3) + '%',
        bkBidF: bT || 1, bkAskF: aT || 1, bkBidP: (bT + aT ? Math.round(bT / (bT + aT) * 100) : 50) + '%', bkAskP: (bT + aT ? Math.round(aT / (bT + aT) * 100) : 50) + '%' };
    })();
    const dpt = (() => {
      const on = s.chartView === 'depth' && !bookOver;
      if (!on || chartEmpty || loading) return { dpView: on, dpBidF: '', dpBidL: '', dpAskF: '', dpAskL: '', dpXs: [], dpYs: [], dpHov: false, dpMidX: '50%', dpMid: D, dpSpread: D, dpBidTot: D, dpAskTot: D };
      const N = 48, qa = Act.quote(m.index, K.MIN_SIZE, true), qb = Act.quote(m.index, K.MIN_SIZE, false), ask0 = qa ? qa.price : lp * (1 + K.SPREAD), bid0 = qb ? qb.price : lp * (1 - K.SPREAD);
      const fa = Act.quote(m.index, capL, true), fb = Act.quote(m.index, capS, false), half = Math.max(fa ? fa.price / lp - 1 : 0, fb ? 1 - fb.price / lp : 0, (ask0 - bid0) / lp * 1.5, .0004) * 1.35, tick = lp * half / N;
      const A = Act.ladder(m.index, true, Array.from({ length: N }, (_, i) => ask0 + i * tick)), B = Act.ladder(m.index, false, Array.from({ length: N }, (_, i) => bid0 - i * tick));
      if (!A.length || !B.length) return { dpView: on, dpBidF: '', dpBidL: '', dpAskF: '', dpAskL: '', dpXs: [], dpYs: [], dpHov: false, dpMidX: '50%', dpMid: D, dpSpread: D, dpBidTot: D, dpAskTot: D };
      const lo = B[N - 1].p, hi = A[N - 1].p, mx = Math.max(A[N - 1].cum, B[N - 1].cum, 1) * 1.1;
      const X = p => (p - lo) / (hi - lo) * 1000, Y = c => 1000 - c / mx * 1000, f = v => v.toFixed(1);
      let bl = 'M' + f(X(bid0)) + ' ' + f(Y(B[0].cum)), al = 'M' + f(X(ask0)) + ' ' + f(Y(A[0].cum));
      for (let i = 1; i < N; i++) { bl += 'H' + f(X(B[i].p)) + 'V' + f(Y(B[i].cum)); al += 'H' + f(X(A[i].p)) + 'V' + f(Y(A[i].cum)); }
      const bf = 'M' + f(X(bid0)) + ' 1000V' + f(Y(B[0].cum)) + bl.slice(bl.indexOf('H')) + 'V1000Z', af = 'M' + f(X(ask0)) + ' 1000V' + f(Y(A[0].cum)) + al.slice(al.indexOf('H')) + 'V1000Z';
      let hv = null; const hx = s.dpHov;
      if (hx != null) { const p = lo + hx * (hi - lo); if (p <= bid0) hv = { side: 'Bids', l: B[Math.min(N - 1, Math.max(0, Math.round((bid0 - p) / tick)))], c: 'var(--g)' }; else if (p >= ask0) hv = { side: 'Asks', l: A[Math.min(N - 1, Math.max(0, Math.round((p - ask0) / tick)))], c: 'var(--rd)' }; }
      const hy = hv ? Y(hv.l.cum) / 10 : 0;
      return { dpView: true, dpBidF: bf, dpBidL: bl, dpAskF: af, dpAskL: al, dpMidX: f(X(lp) / 10) + '%',
        dpXs: [.08, .29, .5, .71, .92].map(q => ({ x: q * 100 + '%', label: K.num(lo + q * (hi - lo), m.dec) })), dpYs: [.25, .5, .75, 1].map(q => ({ y: f(Y(q * mx / 1.1) / 10) + '%', label: K.cpt(q * mx / 1.1) })),
        dpMid: K.num(lp, m.dec), dpSpread: K.num(ask0 - bid0, m.dec) + ' · ' + K.num((ask0 - bid0) / lp * 100, 3) + '%', dpBidTot: K.cpt(B[N - 1].cum), dpAskTot: K.cpt(A[N - 1].cum),
        dpHov: !!hv, dpHx: hv ? f(X(hv.l.p) / 10) + '%' : '0%', dpHy: hy.toFixed(1) + '%', dpTy: Math.max(14, Math.min(86, hy)).toFixed(1) + '%', dpHc: hv ? hv.c : 'var(--t)', dpHside: hv ? hv.side : '', dpHp: hv ? K.num(hv.l.p, m.dec) : '', dpHd: hv ? K.pct((hv.l.p / lp - 1) * 100) : '', dpHt: hv ? K.cpt(hv.l.cum) : '', dpHq: hv ? K.num(hv.l.cum / hv.l.p, m.qd) + ' ' + m.b : '', dpTipX: hv && X(hv.l.p) > 600 ? 'translate(calc(-100% - 12px),-50%)' : 'translate(12px,-50%)',
        dpMove: e => { const r = e.currentTarget.getBoundingClientRect(); this.dpPend = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); if (!this.dpRaf) this.dpRaf = requestAnimationFrame(() => { this.dpRaf = 0; this.setState({ dpHov: this.dpPend }); }); },
        dpLeave: () => { this.dpRaf && cancelAnimationFrame(this.dpRaf); this.dpRaf = 0; this.setState({ dpHov: null }); } };
    })();
    const alPxN = this.num(s.alPx), alMine = (s.alerts || []).filter(a => a.market === m.id), alReason = !alPxN ? 'Enter a price' : Math.abs(alPxN / lp - 1) < 0.0005 ? 'Too close to mark' : '';
    const alv = {
      alOpen: !!s.alOpen, alCount: alMine.length ? String(alMine.length) : '', alBtnBg: s.alOpen ? 'var(--h)' : 'transparent', alMarket: m.id,
      alToggle: () => this.setState({ alOpen: !s.alOpen, alPx: s.alPx || (lp * 1.02).toFixed(m.dec), menu2: null }), alClose: () => this.setState({ alOpen: false }),
      alPx: s.alPx, onAlPx: e => this.setState({ alPx: e.target.value.replace(/[^0-9.]/g, '') }),
      alChips: [-5, -2, 2, 5].map(v => ({ label: (v > 0 ? '+' : '−') + Math.abs(v) + '%', c: v > 0 ? 'var(--g)' : 'var(--rd)', on: () => this.setState({ alPx: (lp * (1 + v / 100)).toFixed(m.dec) }) })),
      alHelp: alPxN ? `Alerts when ${m.id} crosses ${alPxN > lp ? 'above' : 'below'} ${K.num(alPxN, m.dec)}, ${K.pct((alPxN / lp - 1) * 100)} from mark. Drag the line on the chart to move it.` : `Mark ${K.num(lp, m.dec)}`,
      alOk: !alReason, alNo: !!alReason, alReason, alCreate: () => { this.addAlert(m.id, +alPxN.toFixed(m.dec)); this.setState({ alPx: '' }); },
      alHas: alMine.length > 0, alList: alMine.map(a => ({ price: K.num(a.price, m.dec), dist: K.pct((a.price / lp - 1) * 100), c: a.dir === 'above' ? 'var(--g)' : 'var(--rd)', icon: a.dir === 'above' ? 'M12 19V5M5 12l7-7 7 7' : 'M12 5v14M5 12l7 7 7-7', x: () => this.removeAlert(a) })),
    };
    const CC = s.calc;
    let ccv = { ccOpen: false, ccFeePct: K.num(K.FEE * 100, 2) + '%', ccOpenFn: () => this.setState({ calc: { tab: 'pnl', side: side1, lev: String(lev), entry: lp.toFixed(m.dec), exit: (lp * (side1 === 'long' ? 1.05 : .95)).toFixed(m.dec), margin: String(has ? Math.round(margin * 100) / 100 : 100), roe: '50' }, settings: false, proOpen: false }) };
    if (CC) {
      const setC = patch => this.setState(st => ({ calc: { ...st.calc, ...patch } })), L = CC.side === 'long', dir = L ? 1 : -1;
      const cl = Math.max(1, Math.min(m.max, parseInt(CC.lev, 10) || 1)), en = this.num(CC.entry), ex = this.num(CC.exit), mg = this.num(CC.margin), rT = this.num(CC.roe);
      const sz = mg * cl, qty = en ? sz / en : 0, liqP = en ? en * (1 - dir / cl + dir * K.MMR) : 0, fin = v => Number.isFinite(v) ? v : 0;
      const field = (key, label, unit) => ({ label, unit, val: CC[key], on: e => setC({ [key]: e.target.value.replace(/[^0-9.]/g, '') }) });
      let hero = D, heroL = '', heroSub = '', heroC = 'var(--t)', rows = [], warn = '', useLabel = 'Use leverage and margin in order form', use = () => this.setState({ calc: null, lev: cl, inMode: 'margin', margin: String(mg), side: CC.side });
      if (CC.tab === 'pnl') {
        const gross = qty * (ex - en) * dir, fees = sz * K.FEE + qty * ex * K.FEE, liqd = en && ex && (L ? ex <= liqP : ex >= liqP), net = liqd ? -mg : gross - fees, roe = mg ? net / mg * 100 : 0;
        heroL = 'Net PnL'; hero = en && ex && mg ? K.sUsd(fin(net)) : D; heroC = net >= 0 ? 'var(--g)' : 'var(--rd)'; heroSub = en && ex && mg ? `${K.pct(fin(roe))} return on margin` : 'Enter entry, exit and margin';
        rows = [{ label: 'Size', v: mg ? `${K.usd(sz)} · ${K.num(qty, m.qd)} ${m.b}` : D }, { label: 'Price move', v: en && ex ? K.pct((ex / en - 1) * 100) : D }, { label: 'Gross PnL', v: en && ex && mg ? K.sUsd(gross) : D, c: gross >= 0 ? 'var(--g)' : 'var(--rd)' }, { label: 'Open + close fees', v: mg ? '−' + K.usd(fees) : D }, { label: 'Liq. price', v: en ? K.num(liqP, m.dec) : D, c: 'var(--am)' }];
        if (liqd) warn = `Exit is past the liquidation price (${K.num(liqP, m.dec)}); the position would be liquidated and the margin lost.`;
        const fav = en && ex && (L ? ex > en : ex < en);
        if (en && ex && !liqd) { useLabel = fav ? 'Use in order form with this take profit' : 'Use in order form with this stop loss'; use = () => this.setState({ calc: null, lev: cl, inMode: 'margin', margin: String(mg), side: CC.side, tpsl: true, ro: false, tp: fav ? ex.toFixed(m.dec) : s.tp, sl: fav ? s.sl : ex.toFixed(m.dec) }); }
      } else if (CC.tab === 'target') {
        const tp = en * (1 + dir * (rT / 100) / cl);
        heroL = 'Target price'; hero = en && rT ? K.num(tp, m.dec) : D; heroSub = en && rT ? `${K.pct(dir * rT / cl)} move from entry` : 'Enter entry and a target return';
        rows = [{ label: 'PnL at target', v: mg && rT ? K.sUsd(mg * rT / 100) : D, c: 'var(--g)' }, { label: 'Size', v: mg ? K.usd(sz) : D }, { label: 'Liq. price', v: en ? K.num(liqP, m.dec) : D, c: 'var(--am)' }];
        if (en && rT) { useLabel = 'Use in order form with this take profit'; use = () => this.setState({ calc: null, lev: cl, inMode: 'margin', margin: String(mg), side: CC.side, tpsl: true, ro: false, tp: tp.toFixed(m.dec) }); }
      } else {
        heroL = 'Liquidation price'; hero = en ? K.num(liqP, m.dec) : D; heroC = 'var(--am)'; heroSub = en ? `${K.pct((liqP / en - 1) * 100)} from entry` : 'Enter an entry price';
        rows = [{ label: 'Size', v: mg ? K.usd(sz) : D }, { label: 'Max loss', v: mg ? '−' + K.usd(mg) : D, c: 'var(--rd)' }, { label: 'Maintenance margin', v: (K.MMR * 100).toFixed(1) + '%' }];
      }
      ccv = { ...ccv, ccOpen: true, ccClose: () => this.setState({ calc: null }), ccLogo: m.logo, ccMarket: m.id, ccMark: K.num(lp, m.dec),
        ccTabs: [['pnl', 'PnL'], ['target', 'Target price'], ['liq', 'Liquidation']].map(([id, label]) => ({ label, on: () => setC({ tab: id }), bg: CC.tab === id ? 'var(--h)' : 'transparent', color: CC.tab === id ? 'var(--t)' : 'var(--t3)', sh: CC.tab === id ? '0 1px 2px rgba(0,0,0,.25)' : 'none' })),
        ccSides: ['long', 'short'].map(sd => ({ label: cap(sd), on: () => setC({ side: sd }), bg: CC.side === sd ? (sd === 'long' ? 'var(--gf)' : 'var(--rf)') : 'transparent', color: CC.side === sd ? (sd === 'long' ? 'var(--gi)' : 'var(--ri)') : 'var(--t2)' })),
        ccLevLabel: cl + '×', ccLevs: presets.map(v => ({ label: v + '×', on: () => setC({ lev: String(v) }), bg: cl === v ? 'var(--at)' : 'var(--r)', bd: cl === v ? 'var(--a)' : 'var(--l)', color: cl === v ? 'var(--t)' : 'var(--t2)' })),
        ccFields: CC.tab === 'pnl' ? [field('entry', 'Entry price', 'USD'), field('exit', 'Exit price', 'USD'), field('margin', 'Margin', 'USDC')] : CC.tab === 'target' ? [field('entry', 'Entry price', 'USD'), field('roe', 'Target return', '%'), field('margin', 'Margin', 'USDC')] : [field('entry', 'Entry price', 'USD'), field('margin', 'Margin', 'USDC')],
        ccCols: CC.tab === 'liq' ? '1fr 1fr' : phone ? '1fr 1fr' : '1fr 1fr 1fr', ccHero: hero, ccHeroLabel: heroL, ccHeroSub: heroSub, ccHeroC: heroC, ccRows: rows.map(r => ({ ...r, c: r.c || 'var(--t)' })), ccWarn: warn, ccUse: use, ccUseLabel: useLabel };
    }
    const ipv = (() => {
      const q = (s.indQ || '').trim().toLowerCase(), cat = s.indCat || 'All', fav = s.indFav || [];
      const keys = Object.keys(IND).filter(k => (cat === 'All' || (cat === 'Favorites' ? fav.includes(k) : IND[k].cat === cat)) && (!q || (IND[k].name + ' ' + IND[k].short).toLowerCase().includes(q)));
      const E = iList.find(x => x.id === s.indEdit), ED = E && IND[E.t];
      const ie = !E ? { ieOpen: false } : {
        ieOpen: true, ieName: ED.name, ieLabel: lblI(E), ieClose: () => this.setState({ indEdit: null }),
        ieNums: ED.params.filter(x => x[0] !== 'src').map(([k, label]) => ({ label, val: String(E.p[k]), on: ev => { const v = ev.target.value.replace(/[^0-9.]/g, ''); this.indPatch(E.id, x => ({ p: { ...x.p, [k]: v } })); } })),
        ieHasNum: ED.params.some(x => x[0] !== 'src'), ieHasSrc: ED.params.some(x => x[0] === 'src'),
        ieSrcs: [['close', 'Close'], ['open', 'Open'], ['high', 'High'], ['low', 'Low'], ['hl2', 'HL2'], ['hlc3', 'HLC3']].map(([k, label]) => { const on = (E.p.src || 'close') === k; return { label, on: () => this.indPatch(E.id, x => ({ p: { ...x.p, src: k } })), bg: on ? 'var(--at)' : 'transparent', bd: on ? 'var(--a)' : 'var(--l2)', color: on ? 'var(--t)' : 'var(--t2)' }; }),
        ieHasStyle: ED.lines.some((l, li) => ED.colors[li]),
        ieLines: ED.lines.map(([k, name], li) => ({ name, li })).filter(x => ED.colors[x.li]).map(({ name, li }) => ({ name, sw: K.IND_COLORS.map(c => ({ c, ring: E.c[li] === c ? '0 0 0 2px var(--p), 0 0 0 4px ' + c : 'none', on: () => this.indPatch(E.id, x => { const cc = x.c.slice(); cc[li] = c; return { c: cc }; }) })), ws: [[1, 'Thin'], [1.6, 'Medium'], [2.4, 'Thick']].map(([w, tip]) => { const cw = (E.w[li] || 1.3) / (E.t === 'sar' ? 2 : 1), near = [1, 1.6, 2.4].reduce((b, x) => Math.abs(x - cw) < Math.abs(b - cw) ? x : b, 1), on = near === w; return { tip, h: w + 'px', on: () => this.indPatch(E.id, x => { const ww = x.w.slice(); ww[li] = E.t === 'sar' ? w * 2 : w; return { w: ww }; }), bg: on ? 'var(--h)' : 'transparent', fg: on ? 'var(--t)' : 'var(--t3)' }; }) })),
        ieVis: () => this.indPatch(E.id, x => ({ hidden: !x.hidden })), ieVisBg: E.hidden ? 'var(--l2)' : 'var(--af)', ieVisX: E.hidden ? 'translateX(0)' : 'translateX(14px)',
        ieReset: () => { const f = this.indMk(E.t); this.indPatch(E.id, { p: f.p, c: f.c, w: f.w, hidden: false }); }, ieRemove: () => this.indRemove(E.id),
      };
      return { ...ie, ipOpen: !!s.indPick, ipClose: () => this.setState({ indPick: false }), ipQ: s.indQ || '', onIpQ: ev => this.setState({ indQ: ev.target.value }),
        ipCats: ['All', 'Favorites'].concat(K.IND_CATS).map(c => ({ label: c === 'Favorites' ? '★ Favorites' : c, on: () => this.setState({ indCat: c }), bg: cat === c ? 'var(--at)' : 'transparent', bd: cat === c ? 'var(--a)' : 'var(--l2)', color: cat === c ? 'var(--t)' : 'var(--t2)' })),
        ipRows: keys.map(k => { const D = IND[k], n = iList.filter(x => x.t === k).length, f = fav.includes(k); return { name: D.name, short: D.short, desc: D.desc, pane: D.pane === 'main' ? 'Main chart' : 'Sub-pane', n: n ? n + ' on chart' : '', add: () => this.indAdd(k), star: () => this.setState({ indFav: f ? fav.filter(x => x !== k) : fav.concat([k]) }), starTip: f ? 'Remove from favorites' : 'Add to favorites', starC: f ? 'var(--am)' : 'var(--t3)', starF: f ? 'currentColor' : 'none' }; }),
        ipEmpty: keys.length === 0, ipEmptyText: cat === 'Favorites' && !q ? 'Star indicators to pin them here' : 'No indicators match',
        ipGroups: [['main', 'MAIN CHART'], ['sub', 'SUB-PANES']].map(([pn, title]) => ({ title, rows: iList.filter(x => IND[x.t].pane === pn).map((x, i) => ({ label: lblI(x), name: IND[x.t].name, sw: (x.c.filter(Boolean).length ? x.c.filter(Boolean) : ['var(--t2)']).map(c => ({ c })), hid: !!x.hidden, bt: i ? '1px solid var(--l)' : '0', ...actI(x) })) })).filter(g => g.rows.length), ipActiveN: String(iList.length), ipNone: iList.length === 0, ipHasAny: iList.length > 0, ipClear: () => this.setState({ inds: [], indEdit: null }) };
    })();
    const cxv = (() => { const cx = s.ctx; if (!cx || !chartOk) return { ctxOn: false }; const cp = +cx.p.toFixed(m.dec), sz = has ? ' · ' + K.usd(size) : '';
      return { ctxOn: true, ctxX: cx.x + 'px', ctxY: cx.y + 'px', ctxPrice: K.num(cp, m.dec), ctxDist: K.pct((cp / lp - 1) * 100) + ' from mark', ctxNo: e => e.preventDefault(),
        ctxItems: [{ btn: true, label: (cp < lp ? 'Buy limit' : 'Buy stop') + ' @ ' + K.num(cp, m.dec), sub: sz.slice(3), c: 'var(--g)', on: () => this.ctxOrder('long', cp) }, { btn: true, label: (cp > lp ? 'Sell limit' : 'Sell stop') + ' @ ' + K.num(cp, m.dec), sub: sz.slice(3), c: 'var(--rd)', on: () => this.ctxOrder('short', cp) }, { sep: true },
          { btn: true, label: 'Add price alert', sub: '', c: 'var(--t)', on: () => { this.setState({ ctx: null }); this.addAlert(m.id, cp); } }, { btn: true, label: 'Draw horizontal line', sub: '', c: 'var(--t)', on: () => { this.setState({ ctx: null }); this.addDrawing({ type: 'hline', a: { t: Date.now(), p: cp } }); } }, { btn: true, label: 'Copy price', sub: '', c: 'var(--t)', on: () => { try { navigator.clipboard.writeText(String(cp)); } catch (e) {} this.setState({ ctx: null }); } }].map(x => ({ sep: false, btn: false, ...x })) }; })();
    const trade = {
      ...bk, ...dpt, ...alv, ...ccv, ...ipv, ...cxv,
      onChCtx: e => { e.preventDefault(); const pt = this.ptFromEvt(e); if (!pt || !this.chartEl) return; const cr = this.chartEl.getBoundingClientRect(); this.setState({ ctx: { x: Math.min(e.clientX - cr.left, cr.width - 244), y: Math.min(e.clientY - cr.top, cr.height - 230), p: pt.p }, railFly: null }); },
      closeAllOn: conn && (s.tab || 'positions') === 'positions' && positions.length > 1, caLabel: s.caArm ? `Confirm close ${positions.length}` : 'Close all', caBd: s.caArm ? 'var(--rd)' : 'var(--l2)', caBg: s.caArm ? 'var(--rt)' : 'transparent', caC: s.caArm ? 'var(--rd)' : 'var(--t2)',
      closeAllFn: () => { if (s.caArm) return this.closeAll(); this.setState({ caArm: true }); clearTimeout(this.caT); this.caT = setTimeout(() => this.setState({ caArm: false }), 3500); },
      tGrid: phone ? { flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--gp)', padding: 'var(--gp)' } : { flex: 1, minHeight: 0, display: 'grid', gap: 'var(--gp)', padding: 'var(--gp)', gridTemplateColumns: cols, gridTemplateRows: `52px minmax(240px,1fr) minmax(120px,${s.bpH}px)`, gridTemplateAreas: areas },
      showTrades: wide || bookOver || (phone && (s.phView || 'chart') === 'book'), trH: phone ? '560px' : 'auto', trArea: bookOver ? 'ch' : 'tr', trZ: bookOver ? 3 : 'auto', ofHandle: { position: 'absolute', top: 0, bottom: 0, width: '6px', [fl ? 'right' : 'left']: '-5px', cursor: 'col-resize', zIndex: 4 },
      dragBp: this.drag('bp'), dragTr: this.drag('tr'), dragOf: this.drag('of'), resetBp: this.resetLay('bp'), resetTr: this.resetLay('tr'), resetOf: this.resetLay('of'),
      mId: m.id, mBase: m.b, mInit: m.b[0], mColor: m.c, mLogo: m.logo, axTags,
      rail: (() => { const TG = [['lines', 'LINES', [['trend', 'Trend line'], ['ray', 'Ray'], ['ext', 'Extended line'], ['hline', 'Horizontal line'], ['vline', 'Vertical line'], ['arrow', 'Arrow'], ['channel', 'Parallel channel']]], ['fibs', 'FIBONACCI', [['fib', 'Fib retracement'], ['fibext', 'Fib extension'], ['pitch', 'Pitchfork']]], ['shapes', 'SHAPES & TEXT', [['rect', 'Rectangle'], ['circle', 'Ellipse'], ['brush', 'Brush'], ['text', 'Text note']]], ['meas', 'MEASURE', [['measure', 'Measure'], ['prange', 'Price range'], ['drange', 'Date range'], ['long', 'Long position'], ['short', 'Short position']]]], pk = s.railPick || {}, sel = id => { this.endClickDraw && this.endClickDraw(); this.setState({ tool: id, draft: null, menu2: null, railFly: null }); };
        const btn = (title, d, on, act) => ({ btn: true, sep: false, fly: false, title, d, on, bg: act ? 'var(--at)' : 'transparent', color: act ? 'var(--a)' : 'var(--t2)' });
        return [btn('Crosshair', DI.cursor, () => sel('cursor'), s.tool === 'cursor')].concat(TG.map(([g, gl, tools]) => { const act = tools.some(x => x[0] === s.tool), cur = tools.find(x => x[0] === s.tool) || tools.find(x => x[0] === pk[g]) || tools[0]; return { ...btn(cur[1] + (tools.length > 1 ? ' · click again for more' : ''), DI[cur[0]], e => { if (act && tools.length > 1) { const r = e.currentTarget.getBoundingClientRect(), cr = this.chartEl ? this.chartEl.getBoundingClientRect() : { top: 0, left: 0 }; this.setState({ railFly: s.railFly === g ? null : g, flyX: Math.round(r.right - cr.left + 6), flyY: Math.round(r.top - cr.top) }); } else sel(cur[0]); }, act), fly: tools.length > 1 }; }), [{ btn: false, sep: true }, { ...btn('More: magnet, lock, hide, undo, clear', 'M5 12h.01M12 12h.01M19 12h.01', e => { const r = e.currentTarget.getBoundingClientRect(), cr = this.chartEl ? this.chartEl.getBoundingClientRect() : { top: 0, left: 0 }; this.setState({ railFly: s.railFly === 'opts' ? null : 'opts', flyX: Math.round(r.right - cr.left + 6), flyY: Math.max(40, Math.round(r.top - cr.top) - 150) }); }, s.railFly === 'opts' || s.magnet || s.drawLock || s.hideDraw), fly: true }]); })(),
      ...(() => { const TG = { lines: ['LINES', [['trend', 'Trend line'], ['ray', 'Ray'], ['ext', 'Extended line'], ['hline', 'Horizontal line'], ['vline', 'Vertical line'], ['arrow', 'Arrow'], ['channel', 'Parallel channel']]], fibs: ['FIBONACCI', [['fib', 'Fib retracement'], ['fibext', 'Fib extension'], ['pitch', 'Pitchfork']]], shapes: ['SHAPES & TEXT', [['rect', 'Rectangle'], ['circle', 'Ellipse'], ['brush', 'Brush'], ['text', 'Text note']]], meas: ['MEASURE', [['measure', 'Measure'], ['prange', 'Price range'], ['drange', 'Date range'], ['long', 'Long position'], ['short', 'Short position']]] , opts: ['TOOLS', []] }[s.railFly]; const OPT = s.railFly === 'opts' ? [
          [s.magnet ? 'Magnet on: snaps to OHLC' : 'Magnet', DI.magnet, s.magnet, () => this.setState({ magnet: !s.magnet, railFly: null })],
          [s.drawLock ? 'Unlock drawings' : 'Lock drawings', s.drawLock ? DI.lock : DI.unlock, s.drawLock, () => this.setState({ drawLock: !s.drawLock, selDraw: null, railFly: null })],
          [s.hideDraw ? 'Show drawings' : 'Hide drawings', s.hideDraw ? DI.eyeOff : DI.eye, s.hideDraw, () => this.setState({ hideDraw: !s.hideDraw, selDraw: null, railFly: null })],
          ['Undo last drawing', DI.undo, false, () => this.setState(st => ({ selDraw: null, railFly: null, drawings: Object.assign({}, st.drawings, { [st.market]: (st.drawings[st.market] || []).slice(0, -1) }) }))],
          ['Remove all drawings', DI.trash, false, () => this.setState(st => ({ measure: null, selDraw: null, railFly: null, drawings: Object.assign({}, st.drawings, { [st.market]: [] }) }))]
        ].map(([label, d, on, fn]) => ({ label, d, bg: on ? 'var(--at)' : 'transparent', color: on ? 'var(--a)' : 'var(--t)', on: fn })) : null; return { flyOn: !!TG && desktop, flyTitle: TG ? TG[0] : '', flyX: (s.flyX || 44) + 'px', flyY: (s.flyY || 40) + 'px', flyItems: OPT ? OPT : TG ? TG[1].map(([id, label]) => ({ label, d: DI[id], bg: s.tool === id ? 'var(--at)' : 'transparent', color: s.tool === id ? 'var(--a)' : 'var(--t)', on: () => { this.endClickDraw && this.endClickDraw(); this.setState(st => ({ tool: id, draft: null, railFly: null, railPick: { ...(st.railPick || {}), [s.railFly]: id } })); } })) : [] }; })(),
      railW: desktop ? '38px' : '0px', railOn: desktop, alMl: 'auto', plotCursor: s.panning ? 'grabbing' : 'crosshair', onChDown: e => this.chartDown(e), onChDbl: () => this.setState({ view: { count: 96, end: null } }),
      dLine: dLine, dFibs: dFibs.map(f => ({ ...f, da: f.da || 'none' })), dSel: '', ...dsv, dShapes, dW: String(PW), dH: String(PH), dFill: dFill, dFib: dFib, dMeasF: dMeasF, dMeasL: dMeasL, dMeasC: dMeasC, dDots: dDots, dLabels: dLabels, drawOn: chartOk && !s.hideDraw, ovPaths, qChips, qShown: !s.indFold && qChips.length > 0, mRowsShown: s.indFold ? [] : mRows, panes, hasPanes: panes.length > 0, indAny: qChips.length + mRows.length > 0, indFold: () => this.setState({ indFold: !s.indFold }), indFoldLabel: s.indFold ? (qChips.length + mRows.length) + ' indicator' + (qChips.length + mRows.length > 1 ? 's' : '') : 'Hide', indFoldTip: s.indFold ? 'Show indicator values' : 'Hide indicator values', indFoldRot: s.indFold ? 'none' : 'rotate(180deg)',
      rsiH: panes.length ? panes.reduce((a2, p) => a2 + parseInt(p.h, 10), 0) + 'px' : '0px',
      showLatest: chartOk && !C.follow, goLatest: () => this.setState(st => ({ view: { count: st.view.count, end: null } })),
      toolHint: s.tool === 'cursor' ? '' : ((s.tool === 'hline' || s.tool === 'vline' ? 'Click to place the line' : s.tool === 'text' ? 'Click to place a note' : s.tool === 'brush' ? 'Press and drag to draw' : ['channel', 'pitch', 'fibext'].includes(s.tool) ? (!s.draft ? 'Click the first point' : s.draft.stage === 2 ? 'Click the third point' : 'Click the second point') : (s.tool === 'long' || s.tool === 'short') ? (s.draft ? 'Click to set the target' : 'Click the entry (drag to set target)') : s.draft ? 'Click to place the end point' : 'Click to place the start point') + ' · Esc to cancel'),
      ctypeLabel: CTL[s.ctype], ctypes: [['candles', 'Candles'], ['hollow', 'Hollow candles'], ['bars', 'Bars'], ['line', 'Line'], ['area', 'Area']].map(([id, label]) => ({ label: label, on: () => this.setState({ ctype: id, menu2: null, ref: true }), bg: s.ctype === id ? 'var(--h)' : 'transparent', color: s.ctype === id ? 'var(--t)' : 'var(--t2)', check: s.ctype === id ? '✓' : '' })),
      indCount: iList.length ? String(iList.length) : '', menuType: s.menu2 === 'type', menuX: s.menuX + 'px', openType: e => this.openMenu('type', e), openInd: () => this.setState({ indPick: true, indQ: '', menu2: null }), closeMenus: () => this.setState({ menu2: null }), typeBtnBg: s.menu2 === 'type' ? 'var(--h)' : 'transparent', indBtnBg: s.indPick ? 'var(--h)' : 'transparent',
      chartRef: this.chartRef, toggleFull: () => this.setState({ chartFull: !s.chartFull, menu2: null }), fullTitle: s.chartFull ? 'Exit focus (Esc)' : 'Focus chart', fullIcon: s.chartFull ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5' : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5', cPos: s.chartFull ? 'absolute' : 'relative', cInset: s.chartFull ? 'var(--gp)' : 'auto', cZ: s.chartFull ? '27' : 'auto', cSh: s.chartFull ? 'var(--sh)' : 'none', mcView: s.chartView !== 'depth',
      views: [['moment', 'Price'], ['depth', 'Depth'], ...(desktop && !wide ? [['book', 'Order book']] : [])].map(([id, label]) => { const on = id === 'book' ? bookOver : !bookOver && (s.chartView || 'moment') === id; return { label, on: () => this.setState(id === 'book' ? { bookOver: true, bkTab: 'book' } : { chartView: id, bookOver: false }), bg: on ? 'var(--h)' : 'transparent', color: on ? 'var(--t)' : 'var(--t3)', sh: on ? '0 1px 2px rgba(0,0,0,.25)' : 'none' }; }), priceBg: flashBg(m.id), oraclePulse: stale ? this.dot('var(--am)', false) : this.dot('var(--g)', true), hlDisp: s.w >= 1180 ? 'flex' : 'none', pp: K.parts(K.num(lp, m.dec)), mMax: m.max + '×', mStatus: m.status || '', price: K.num(lp, m.dec), priceColor: flashC(m.id),
      ch24: `${ch24 >= 0 ? '+' : '−'}${K.num(Math.abs(ch24), m.dec)}`, ch24p: K.pct(ch24 / S24.open * 100), ch24c: gc(ch24), hi24: K.num(Math.max(S24.hi, lp), m.dec), lo24: K.num(Math.min(S24.lo, lp), m.dec),
      oiL: K.cpt(m.oiL), oiS: K.cpt(m.oiS), oiLf: m.oiL / (m.oiL + m.oiS), oiSf: m.oiS / (m.oiL + m.oiS), fundWho: m.fund >= 0 ? 'Longs pay' : 'Shorts pay', fundRate: K.num(Math.abs(m.fund), 4) + '%',
      oracleAge: stale ? `${K.age(ageOf(m))} ago · stale` : `${K.age(ageOf(m))} ago`, oracleSrc: store.oracleMode === 'pyth' ? 'Pyth Pro' : 'Dev oracle', oracleColor: stale ? 'var(--am)' : 'var(--t)', oracleDot: stale ? 'var(--am)' : 'var(--g)',
      switcherOpen: s.switcher, toggleSwitcher: () => this.setState({ switcher: !s.switcher, swq: '' }), closeSwitcher: () => this.setState({ switcher: false }), swq: s.swq, onSwq: e => this.setState({ swq: e.target.value }),
      switchList: all.filter(x => !swq || x.id.toLowerCase().includes(swq) || x.name.toLowerCase().includes(swq)).map(x => ({ id: x.id, name: x.name, init: x.b[0], color: x.c, logo: x.logo, pp: K.parts(K.num(priceOf(x.id), x.dec)), price: K.num(priceOf(x.id), x.dec), max: x.max + '×', status: x.status || '', bg: x.id === m.id ? 'var(--h)' : 'transparent', pick: () => this.setState({ market: x.id, switcher: false, preSide: '', lev: Math.min(s.lev, x.max), view: { count: 96, end: null }, measure: null, draft: null }) })),
      tfs: Object.keys(K.TF).map(t => ({ label: t, on: () => this.setState({ tf: t, view: { count: 96, end: null }, measure: null }), bg: s.tf === t ? 'var(--h)' : 'transparent', color: s.tf === t ? 'var(--t)' : 'var(--t3)' })),
      modes: [['candles', 'Candles'], ['line', 'Line']].map(([id, label]) => ({ label, on: () => this.setState({ mode: id }), bg: s.mode === id ? 'var(--h)' : 'transparent', color: s.mode === id ? 'var(--t)' : 'var(--t3)' })),
      pythBd: s.pyth ? 'var(--a)' : 'var(--l2)', pythBg: s.pyth ? 'var(--at)' : 'transparent', pythColor: s.pyth ? 'var(--t)' : 'var(--t3)', togglePyth: () => this.setState({ pyth: !s.pyth }),
      refBd: s.ref ? 'var(--t3)' : 'var(--l2)', refBg: s.ref ? 'var(--h)' : 'transparent', refColor: s.ref ? 'var(--t)' : 'var(--t3)', toggleRef: () => this.setState({ ref: !s.ref }),
      showCandles: chartOk && s.ref && s.mode === 'candles', showLine: chartOk && s.ref && s.mode === 'line', showPyth: chartOk && s.pyth, chartOk, chartEmpty, chartLoading, noSeries: chartOk && !s.ref && !s.pyth,
      cUp: chartOk && s.ref && s.ctype === 'candles' ? C.up : '', cUpO: chartOk && s.ref && s.ctype === 'hollow' ? C.up : '', cDn: chartOk && s.ref && (s.ctype === 'candles' || s.ctype === 'hollow') ? C.dn : '', cWu: chartOk && s.ref && (s.ctype === 'candles' || s.ctype === 'hollow') ? C.wu : '', cWd: chartOk && s.ref && (s.ctype === 'candles' || s.ctype === 'hollow') ? C.wd : '', cBu: chartOk && s.ref && s.ctype === 'bars' ? C.bu : '', cBd: chartOk && s.ref && s.ctype === 'bars' ? C.bd : '', cLn: chartOk && s.ref && (s.ctype === 'line' || s.ctype === 'area') ? C.ln : '', cLa: chartOk && s.ref && s.ctype === 'area' ? C.la : '', cPy: chartOk && s.pyth ? C.py : '', cVu: chartOk && volOn ? C.vu : '', cVd: chartOk && volOn ? C.vd : '', grid: chartOk ? C.grid.map(g => { const gy = 28 + parseFloat(g.top) / 100 * aph, lastY = 28 + parseFloat(C.lastTop) / 100 * aph, near = ((s.pyth || s.ref) && Math.abs(gy - lastY) < 13) || axTags.some(a => Math.abs(parseFloat(a.y) - gy) < 13); return { ...g, o: near ? 0 : 1 }; }) : [], xl: chartOk ? C.xl : [], offTopY: (s.plotW || 800) < 620 ? '54px' : '6px', lgSrcDisp: (s.plotW || 800) < 520 ? 'none' : 'inline', offTop, offBot, offTopOn: offTop.length > 0, offBotOn: offBot.length > 0, inLines: chartOk ? stackLbl(C.inl.filter(l => !l.mini)).concat(C.inl.filter(l => l.mini)).map(l => { const on = dg && dg.key === l.key; return { ...l, pill: !l.mini, bs: l.kind === 'alert' ? 'dotted' : 'dashed', op: on ? 1 : l.mini ? .5 : .92, pe: l.drag ? 'auto' : 'none', cur: l.drag ? 'ns-resize' : 'default', down: l.drag ? e => this.lineDown(e, l) : undefined, sm: this.stopPd, tip: l.drag ? 'Drag to move' : l.label, sh: on ? '0 0 0 3px var(--at)' : 'none', pr: l.x ? '2px' : '6px', grip: !!l.drag, hasX: !!l.x, hasEst: !!l.est, bellOn: !!l.bell }; }) : [], lnRef: this.lnRef, plotRef: this.plotRef, chYf: String(Math.min(1, Math.max(0, s.hy))), pinsTop: chartOk ? C.pinsTop.filter(l => !l.noTag) : [], pinsBot: chartOk ? C.pinsBot.filter(l => !l.noTag) : [],
      tagTop: C.lastTop, tagBg: s.pyth ? 'var(--af)' : C.lastUp ? 'var(--gf)' : 'var(--rf)', tagInk: s.pyth ? 'var(--ai)' : C.lastUp ? 'var(--gi)' : 'var(--ri)', tagShow: chartOk && (s.pyth || s.ref),
      lgSrc: store.oracleMode === 'pyth' ? 'Pyth Pro · oracle' : 'Dev oracle · test prices', lgO: K.num(cd.o, m.dec), lgH: K.num(cd.h, m.dec), lgL: K.num(cd.l, m.dec), lgC: K.num(cd.c, m.dec), lgChg: K.pct(cchg), lgColor: cd.c >= cd.o ? 'var(--g)' : 'var(--rd)', lgTf: s.tf, lgPyth: K.num(lp, m.dec), lgShowRef: chartOk && s.ref,
      chOn: hov && chartOk, chX: ((hi + .5) / C.slots * 100).toFixed(2) + '%', chY: (Math.min(1, Math.max(0, s.hy)) * 100).toFixed(2) + '%', chP: K.num(C.hi - Math.min(1, Math.max(0, s.hy)) * (C.hi - C.lo), m.dec), chT: C.tl(cd.t),
      onChMove: e => { const r = e.currentTarget.getBoundingClientRect(); this.pm = { hx: (e.clientX - r.left) / r.width, hy: (e.clientY - r.top - 28) / Math.max(1, r.height - 44) }; if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.setState(this.pm); }); },
      onChLeave: () => { this.raf && cancelAnimationFrame(this.raf); this.raf = 0; this.pm = { hx: null }; this.setState({ hx: null }); },
      trs, trEmpty: !loading && !trs.length, trLoading: loading, trHas: trs.length > 0, trEmptyText: `No trades yet in ${m.id}`, mMaxL: K.cpt(capL), mMaxS: K.cpt(capS),
      phoneChartH: phone && !s.chartFull ? '420px' : 'auto',
      phViews: [['chart', 'Chart'], ['book', 'Order book'], ['info', 'Info']].map(([id, label]) => { const on = (s.phView || 'chart') === id; return { label, on: () => this.setState({ phView: id }), bg: on ? 'var(--r)' : 'transparent', color: on ? 'var(--t)' : 'var(--t3)', sh: on ? '0 1px 2px rgba(0,0,0,.3)' : 'none' }; }),
      phInfo: phone && s.phView === 'info', chDisp: phone && !s.chartFull && (s.phView || 'chart') !== 'chart' ? 'none' : 'flex',
      phSheet: phone && !!s.phSheet, sheetD: !phone ? 'contents' : s.phSheet ? 'flex' : 'none', ofFlex: phone ? '1 1 auto' : 'none', acctDisp: phone ? 'none' : 'grid',
      closeSheet: () => this.setState({ phSheet: false, preSide: null }), phLong: () => this.setState({ phSheet: true, side: 'long', preSide: null }), phShort: () => this.setState({ phSheet: true, side: 'short', preSide: null }),
    };

    // tables (bottom panel + portfolio)
    const openEdit = (p, tab) => this.setState({ edit: { id: p.id, tab, dir: 'add', amt: '', pct: 50, tp: p.tp ? p.tp.toFixed(K.byId[p.market].dec) : '', sl: p.sl ? p.sl.toFixed(K.byId[p.market].dec) : '' } });
    const posRows = positions.map(p => { const pm = K.byId[p.market], mkp = priceOf(p.market), pn = K.pnlOf(p, mkp) - p.owed; return { market: p.market, init: pm.b[0], color: pm.c, logo: pm.logo, side: `${cap(p.side)} ${Math.round(p.lev * 10) / 10}×${p.mode === 'cross' ? ' Cross' : ''}`, sc: p.side === 'long' ? 'var(--g)' : 'var(--rd)', sbg: p.side === 'long' ? 'var(--gt)' : 'var(--rt)', size: K.usd(p.size), qty: `${K.num(p.size / p.entry, pm.qd)} ${pm.b}`, entry: K.num(p.entry, pm.dec), mark: K.num(mkp, pm.dec), liq: K.num(this.liq(p), pm.dec), margin: K.usd(p.margin), pnl: K.sUsd(pn), pnlPct: K.pct(pn / p.margin * 100, 1), pc: gc(pn), tpsl: `${p.tp ? K.num(p.tp, pm.dec) : p.tps ? K.num(p.tps[0].p, pm.dec) + (p.tps.length > 1 ? ' +' + (p.tps.length - 1) : '') : '—'} / ${p.sl ? K.num(p.sl, pm.dec) : '—'}`, close: e => { e && e.stopPropagation(); this.close(p); }, reverse: e => { e && e.stopPropagation(); this.reverse(p); }, edit: e => { e && e.stopPropagation(); openEdit(p, 'coll'); }, editTpsl: e => { e && e.stopPropagation(); openEdit(p, 'tpsl'); }, goto: () => this.setState({ page: 'trade', market: p.market }) }; });
    const histRows = s.history.map(h => { const hm = K.byId[h.market]; return { time: K.fdt(h.t), market: h.market, action: h.action, ac: /Liquidated/.test(h.action) ? 'var(--am)' : /^(Open|Limit|Stop) Long/.test(h.action) ? 'var(--g)' : /^(Open|Limit|Stop) Short/.test(h.action) ? 'var(--rd)' : 'var(--t2)', price: K.num(h.price, hm.dec), size: K.usd(h.size), fee: K.usd(h.fee), pnl: h.pnl == null ? D : K.sUsd(h.pnl), pc: h.pnl == null ? 'var(--t3)' : gc(h.pnl), href: K.txUrl(h.sig) }; });
    const fundRows = s.funding.map(f => ({ time: K.fdt(f.t), market: f.market, side: f.side, sc: f.side === 'Long' ? 'var(--g)' : 'var(--rd)', size: K.usd(f.size), rate: K.num(f.rate, 4) + '%', pay: (f.pay < 0 ? '−$' : '+$') + K.num(Math.abs(f.pay), 4), pc: gc(f.pay) }));
    const ordRows = [
      ...s.orders.map(o => { const om = K.byId[o.market], mk = priceOf(o.market); return { market: o.market, logo: om.logo, side: o.ro ? `${cap(o.side)} · reduce` : `${cap(o.side)} ${Math.round(o.lev * 10) / 10}×`, sc: o.side === 'long' ? 'var(--g)' : 'var(--rd)', sbg: o.side === 'long' ? 'var(--gt)' : 'var(--rt)', type: o.label, sub: o.ro ? 'Reduce only' : o.tif === 'post' ? 'Post only' : 'Opens position', tc: o.kind === 3 ? 'var(--g)' : o.kind === 4 ? 'var(--rd)' : 'var(--t)', trig: K.num(o.price, om.dec), dist: K.pct((o.price / mk - 1) * 100) + ' from mark', mark: K.num(mk, om.dec), size: o.full ? 'Rest of position' : K.usd(o.size), margin: o.ro ? D : K.usd(o.margin), time: K.fdt(o.t), cancel: () => this.cancelOrder(o), goto: () => this.setState({ page: 'trade', market: o.market }) }; }),
      ...positions.flatMap(p => { const pm = K.byId[p.market], mk = priceOf(p.market); return [['tp', 'Take profit', 'var(--g)'], ['sl', 'Stop loss', 'var(--rd)']].filter(([k]) => p[k]).map(([k, label, tc]) => ({ market: p.market, logo: pm.logo, side: `${cap(p.side)} ${Math.round(p.lev * 10) / 10}×${p.mode === 'cross' ? ' Cross' : ''}`, sc: p.side === 'long' ? 'var(--g)' : 'var(--rd)', sbg: p.side === 'long' ? 'var(--gt)' : 'var(--rt)', type: label, sub: 'Reduce only', tc, trig: K.num(p[k], pm.dec), dist: K.pct((p[k] / mk - 1) * 100) + ' from mark', mark: K.num(mk, pm.dec), size: 'Full position', margin: D, time: K.fdt(p.openedAt), cancel: () => this.clearTrig(p, k), goto: () => this.setState({ page: 'trade', market: p.market }) })); }),
      ...(s.alerts || []).map(a => { const am = K.byId[a.market], mk = priceOf(a.market); return { market: a.market, logo: am.logo, side: 'Alert', sc: 'var(--t2)', sbg: 'var(--r)', type: 'Price alert', sub: `Crosses ${a.dir}`, tc: 'var(--t2)', trig: K.num(a.price, am.dec), dist: K.pct((a.price / mk - 1) * 100) + ' from mark', mark: K.num(mk, am.dec), size: D, margin: D, time: K.fdt(a.t), cancel: () => this.removeAlert(a), goto: () => this.setState({ page: 'trade', market: a.market }) }; }),
    ];
    const mkTabs = key => [['positions', 'Positions', String(positions.length)], ['orders', 'Orders', String(ordRows.length)], ['history', 'Trade history', ''], ['funding', 'Funding', '']].map(([id, label, n]) => ({ label, n: conn ? n : '', on: () => this.setState({ [key]: id }), color: s[key] === id ? 'var(--t)' : 'var(--t3)', bar: s[key] === id ? 'var(--a)' : 'transparent' }));
    const tbl = (key, pre) => ({
      [pre + 'Tabs']: mkTabs(key), [pre + 'Disc']: !conn,
      [pre + 'Pos']: conn && s[key] === 'positions' && posRows.length > 0, [pre + 'PosEmpty']: conn && s[key] === 'positions' && !posRows.length,
      [pre + 'Ord']: conn && s[key] === 'orders' && ordRows.length > 0, [pre + 'OrdEmpty']: conn && s[key] === 'orders' && !ordRows.length,
      [pre + 'Hist']: conn && s[key] === 'history' && histRows.length > 0, [pre + 'HistEmpty']: conn && s[key] === 'history' && !histRows.length,
      [pre + 'Fund']: conn && s[key] === 'funding' && fundRows.length > 0, [pre + 'FundEmpty']: conn && s[key] === 'funding' && !fundRows.length,
    });
    const E = s.edit, ep = E && positions.find(p => p.id === E.id);
    let ed = { eOpen: false };
    if (ep) {
      const pm = K.byId[ep.market], dec = pm.dec, mk = priceOf(ep.market), pn = K.pnlOf(ep, mk) - ep.owed, L = ep.side === 'long', fl = v => Math.round(v * 10) / 10 + '×', liq = this.liq(ep);
      const setE = patch => this.setState(st => ({ edit: { ...st.edit, ...patch } }));
      const seg = (on, extra) => ({ bg: on ? 'var(--h)' : 'transparent', color: on ? 'var(--t)' : 'var(--t3)', sh: on ? '0 1px 2px rgba(0,0,0,.25)' : 'none', ...extra });
      const chip = on => ({ bg: on ? 'var(--at)' : 'var(--r)', bd: on ? 'var(--a)' : 'var(--l)', color: on ? 'var(--t)' : 'var(--t2)' });
      ed = { eOpen: true, eLogo: pm.logo, eMarket: ep.market, eSide: `${cap(ep.side)} ${fl(ep.lev)}`, eSc: L ? 'var(--g)' : 'var(--rd)', eSbg: L ? 'var(--gt)' : 'var(--rt)', eSummary: `${K.usd(ep.size)} · Entry ${K.num(ep.entry, dec)} ·`, ePnl: K.sUsd(pn), ePnlC: gc(pn), eMark: K.num(mk, dec), eLiq: K.num(liq, dec),
        eCancel: () => this.setState({ edit: null }), eTabs: [['coll', 'Collateral'], ['close', 'Close'], ['tpsl', 'TP / SL']].map(([id, label]) => seg(E.tab === id, { label, on: () => setE({ tab: id }) })),
        eColl: E.tab === 'coll', eCls: E.tab === 'close', eTps: E.tab === 'tpsl' };
      let reason = '', go = null, btn = '', bg = 'var(--af)', ink = 'var(--ai)';
      if (E.tab === 'coll') {
        const add = E.dir === 'add', a = this.num(E.amt), nm = Math.max(1e-9, add ? ep.margin + a : ep.margin - a), nl = ep.size / nm, nliq = this.liq({ ...ep, margin: nm, lev: nl }), maxRem = Math.max(0, Math.floor((ep.margin - ep.size / pm.max) * 100) / 100), chg = a > 0;
        reason = !a ? 'Enter amount' : add && a > s.usdc ? 'Insufficient USDC' : !add && a > maxRem ? `Max removable is ${K.usd(maxRem)}` : !add && (L ? nliq >= mk * 0.995 : nliq <= mk * 1.005) ? 'Too close to liquidation' : '';
        Object.assign(ed, { eDirs: [['add', 'Add'], ['remove', 'Remove']].map(([id, label]) => seg(E.dir === id, { label, on: () => setE({ dir: id, amt: '' }) })), eAmt: E.amt, onEAmt: e => setE({ amt: e.target.value.replace(/[^0-9.]/g, '') }),
          eAvailLabel: add ? 'Available' : 'Removable', eAvail: `${K.num(add ? s.usdc : maxRem)} USDC`, eMax: () => setE({ amt: String(Math.floor((add ? s.usdc : maxRem) * 100) / 100) }),
          eRows: [{ label: 'Margin', a: K.usd(ep.margin), b: K.usd(nm) }, { label: 'Leverage', a: fl(ep.lev), b: fl(nl) }, { label: 'Liq. price', a: K.num(liq, dec), b: K.num(nliq, dec), liq: 1 }].map(r => ({ ...r, chg, ac: chg ? 'var(--t3)' : r.liq ? 'var(--am)' : 'var(--t)', color: r.liq ? 'var(--am)' : 'var(--t)' })) });
        btn = add ? 'Add collateral' : 'Remove collateral'; go = () => this.editColl(ep, add ? a : -a);
      } else if (E.tab === 'close') {
        const f = E.pct / 100, csz = ep.size * f, cq = Act.quote(pm.index, csz, !L), xp = cq ? cq.price : mk, cp = K.pnlOf(ep, xp) * f - ep.owed * f, cfee = csz / ep.entry * xp * pm.closeFee, recv = ep.margin * f + cp - cfee;
        reason = f < 1 && ep.size * (1 - f) < K.MIN_SIZE ? 'Remaining size would be below $10' : '';
        Object.assign(ed, { ePctLabel: E.pct + '%', ePctW: E.pct + '%', ePcts: [25, 50, 75, 100].map(v => ({ label: v === 100 ? 'All' : v + '%', on: () => setE({ pct: v }), ...chip(E.pct === v) })),
          eCRows: [{ label: 'Close size', v: `${K.usd(csz)} · ${K.num(csz / ep.entry, pm.qd)} ${pm.b}` }, { label: 'Est. exit price', v: K.num(xp, dec) }, { label: 'Est. realized PnL', v: K.sUsd(cp), color: gc(cp) }, { label: `Close fee · ${K.num(pm.closeFee * 100, 2)}%`, v: K.usd(cfee), color: 'var(--t2)' }, { label: 'You receive', v: K.usd(Math.max(0, recv)) }].map(r => ({ ...r, color: r.color || 'var(--t)' })) });
        btn = f >= 1 ? 'Close position' : `Close ${E.pct}%`; bg = 'var(--rf)'; ink = 'var(--ri)'; go = () => { if (f >= 1) { this.setState({ edit: null }); this.close(ep); } else this.reduce(ep, f); };
      } else {
        const tp = this.num(E.tp), sl = this.num(E.sl), at = v => { const x = K.pnlOf(ep, v); return `Est. ${K.sUsd(x)} · ${K.pct(x / ep.margin * 100, 1)}`; }, dir = L ? 1 : -1;
        const same = (a, b) => Math.abs((a || 0) - (b || 0)) < Math.pow(10, -dec) / 2;
        reason = tp && (L ? tp <= mk : tp >= mk) ? `TP must be ${L ? 'above' : 'below'} mark` : sl && (L ? sl >= mk : sl <= mk) ? `SL must be ${L ? 'below' : 'above'} mark` : sl && (L ? sl <= liq : sl >= liq) ? 'SL is past the liquidation price' : same(tp, ep.tp) && same(sl, ep.sl) ? 'No changes' : '';
        const pTp = r => ep.entry * (1 + dir * r / 100 / ep.lev), pSl = r => ep.entry * (1 - dir * r / 100 / ep.lev);
        Object.assign(ed, { eTp: E.tp, eSl: E.sl, onETp: e => setE({ tp: e.target.value.replace(/[^0-9.]/g, '') }), onESl: e => setE({ sl: e.target.value.replace(/[^0-9.]/g, '') }),
          eTpPnl: tp ? at(tp) : 'Not set', eTpC: tp ? gc(K.pnlOf(ep, tp)) : 'var(--t3)', eSlPnl: sl ? at(sl) : 'Not set', eSlC: sl ? gc(K.pnlOf(ep, sl)) : 'var(--t3)',
          eTpChips: [25, 50, 100, 200].map(r => ({ label: '+' + r + '%', on: () => setE({ tp: pTp(r).toFixed(dec) }), ...chip(!!tp && same(tp, +pTp(r).toFixed(dec))) })),
          eSlChips: [10, 25, 50, 75].map(r => ({ label: '−' + r + '%', on: () => setE({ sl: pSl(r).toFixed(dec) }), ...chip(!!sl && same(sl, +pSl(r).toFixed(dec))) })) });
        btn = 'Save TP / SL'; go = () => this.saveTpsl(ep, tp || null, sl || null);
      }
      Object.assign(ed, { eOk: !reason, eNo: !!reason, eReason: reason, eBtn: btn, eGo: go, eBg: bg, eInk: ink });
    }
    const tables = { ...ed, posRows, ordRows, histRows, fundRows, ...tbl(s.page === 'portfolio' ? 'ptab' : 'tab', 't'), tblDesk: desktop, tblPhone: phone };

    // portfolio
    const realized = s.history.reduce((a, h) => a + (h.pnl || 0), 0);
    if (conn) store.loadEquity(s.prange);
    const eqPts = (store.equity.get(s.prange) || []).map(q => Number(q.equity) / 1e6), EA = K.area(eqPts.length ? eqPts.concat([equity]) : [equity, equity]);
    const V = K.VAULT, vVal = s.shares * V.price, vPnl = vVal - s.vdep;
    const pf = {
      pfConn: conn, pfDisc: !conn, pfEquity: K.usd(equity), pfUpnl: K.sUsd(upnl), pfUpnlC: gc(upnl), pfReal: K.sUsd(realized), pfRealC: gc(realized), pfUsed: K.usd(used), pfUsedPct: equity > 0 ? K.num(used / equity * 100, 1) + '% of equity' : '', pfAvail: K.usd(s.usdc),
      pfLine: EA.line, pfFill: EA.fill, pfHi: K.usd(EA.hi), pfLo: K.usd(EA.lo),
      pRanges: ['7D', '30D', 'All'].map(r => ({ label: r, on: () => this.setState({ prange: r }), bg: s.prange === r ? 'var(--h)' : 'transparent', color: s.prange === r ? 'var(--t)' : 'var(--t3)' })),
      kpiCols: phone ? 'repeat(2,minmax(0,1fr))' : 'repeat(5,minmax(0,1fr))', pfCols: phone ? 'minmax(0,1fr)' : 'minmax(0,2fr) minmax(280px,1fr)',
      balUsdc: K.num(s.usdc), balWallet: z.walletUsdc == null ? D : K.num(z.walletUsdc), balShares: K.num(s.shares), balVault: K.usd(vVal), balVaultPnl: K.sUsd(vPnl), balVaultC: gc(vPnl), goVault: () => this.go('vault'), goTrade: () => this.go('trade'),
    };

    // vault
    const VC = this.vchart(s.vrange, s.vhov);
    const earn = [['Trading fees', V.fees, 'var(--a)'], ['Funding', V.funding, 'var(--g)'], ['Trader losses (net)', V.traders, 'var(--t2)']], eTot = earn.reduce((a, e) => a + e[1], 0);
    const nets = all.map(x => x.oiL - x.oiS), maxNet = Math.max(...nets.map(Math.abs));
    const va = this.num(s.vamt), vdepo = s.vtab === 'deposit';
    const vReason = uninit ? 'Protocol not initialized' : !va ? 'Enter amount' : vdepo && va > s.usdc ? 'Not enough trading balance' : !vdepo && va > vVal + .005 ? 'Exceeds your vault balance' : !vdepo && va > V.withdrawable ? 'Above the vault’s free liquidity right now' : '';
    const vault = {
      vNav: K.cpt(V.nav), vPrice: K.num(V.price, 4), vApr: V.apr != null ? K.num(V.apr, 1) + '%' : D, vUtil: K.num(V.util, 1) + '%', vUtilW: K.num(V.util, 1) + '%', vYour: conn ? K.usd(vVal) : D,
      ...VC,
      vRanges: ['7D', '30D', 'All'].map(r => ({ label: r, on: () => this.setState({ vrange: r, vhov: null }), bg: s.vrange === r ? 'var(--h)' : 'transparent', color: s.vrange === r ? 'var(--t)' : 'var(--t3)', sh: s.vrange === r ? '0 1px 2px rgba(0,0,0,.25)' : 'none' })),
      ...this.earnView(V, conn ? vVal : 0),
      expo: all.map((x, i) => { const n = nets[i]; return { id: x.id, init: x.b[0], color: x.c, logo: x.logo, L: K.cpt(x.oiL), S: K.cpt(x.oiS), net: (n > 0 ? 'Short ' : 'Long ') + K.cpt(Math.abs(n)), nc: n > 0 ? 'var(--rd)' : 'var(--g)', bw: (Math.abs(n) / maxNet * 50).toFixed(1) + '%', bl: n > 0 ? (50 - Math.abs(n) / maxNet * 50).toFixed(1) + '%' : '50%' }; }),
      vTabs: [['deposit', 'Deposit'], ['withdraw', 'Withdraw']].map(([id, label]) => ({ label, on: () => this.setState({ vtab: id, vamt: '' }), bg: s.vtab === id ? 'var(--h)' : 'transparent', sh: s.vtab === id ? '0 1px 2px rgba(0,0,0,.25)' : 'none', color: s.vtab === id ? 'var(--t)' : 'var(--t3)' })),
      vFocBd: s.vfoc ? 'var(--a)' : 'var(--l2)', vFocSh: s.vfoc ? '0 0 0 3px var(--at)' : 'none', vFocOn: () => this.setState({ vfoc: true }), vFocOff: () => this.setState({ vfoc: false }),
      vamt: s.vamt, onVamt: e => this.setState({ vamt: e.target.value.replace(/[^0-9.,]/g, '') }), vMax: () => this.setState({ vamt: String(Math.floor((vdepo ? s.usdc : vVal) * 100) / 100) }),
      vBalLabel: vdepo ? 'Trading balance' : 'In vault', vBal: vdepo ? `${K.num(s.usdc)} USDC` : `${K.num(vVal)} USDC`, vRecvLabel: vdepo ? 'You receive' : 'Shares burned', vRecv: `${K.num(va / V.price)} shares`,
      vWithdrawable: K.cpt(V.withdrawable), vIsW: !vdepo,
      vOk: conn && !vReason, vNo: conn && !!vReason, vReason, vDisc: !conn, vBtn: vdepo ? 'Deposit USDC' : 'Withdraw USDC', vGo: () => this.vaultGo(),
      vShares: K.num(s.shares), vDep: K.usd(s.vdep), vPnl: K.sUsd(vPnl), vPnlC: gc(vPnl), vPnlPct: s.vdep ? K.pct(vPnl / s.vdep * 100, 1) : '',
      vCols: phone ? 'minmax(0,1fr)' : 'minmax(0,1fr) 360px', vStatCols: phone ? 'repeat(2,minmax(0,1fr))' : 'repeat(5,minmax(0,1fr))',
    };

    const au = (() => {
      const st = s.auStep, em = (s.auEmail || '').trim(), okEm = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em), busy = s.auBusy;
      const fail = e => this.setState({ auBusy: '', auErr: (e && e.message) || 'Something went wrong. Please try again.' });
      const left = Math.max(0, Math.ceil((s.auResendAt - now) / 1000)), code = (s.auCode || '').replace(/\D/g, '').slice(0, 6);
      const verify = v => { this.setState({ auBusy: 'e', auErr: '' }); z.verifyEmailCode(v).then(() => this.setState({ auBusy: '', auStep: 'main', auCode: '' }), e => { this.setState({ auCode: '' }); fail(e); }); };
      const sendCode = () => { this.setState({ auBusy: 'e', auErr: '' }); return z.sendEmailCode(em).then(() => this.setState({ auBusy: '', auStep: 'code', auCode: '', auResendAt: Date.now() + 30000 }), fail); };
      const top3 = ['BTC-USD', 'ETH-USD', 'SOL-USD'].map((id, i) => { const mm = K.byId[id], p = priceOf(id), ch = (p / K.stats(id).open - 1) * 100; return { id, logo: mm.logo, price: K.num(p, mm.dec), chg: K.pct(ch), c: ch >= 0 ? 'var(--g)' : 'var(--rd)', bt: i ? '1px solid var(--l)' : '0' }; });
      return { authGate: !conn, auSide: s.w >= 960, auPhone: s.w < 960, auCols: s.w >= 960 ? 'minmax(0,1.05fr) minmax(0,1fr)' : 'minmax(0,1fr)', auTick: top3, auMarkets: String(all.length),
        auMain: st === 'main' && !z.pending, auCodeStep: st === 'code' && !z.pending, auWalletStep: st === 'wallet' && !z.pending, auPending: z.pending,
        auEmail: s.auEmail, onAuEmail: e => this.setState({ auEmail: e.target.value, auErr: '' }),
        auErr: s.auErr, auBusyE: busy === 'e', auBusyG: busy === 'g', auBusyGNo: busy !== 'g', auBusyW: busy.startsWith('w'), auBusyWNo: !busy.startsWith('w'),
        auGoogle: () => { if (busy) return; this.setState({ auBusy: 'g', auErr: '' }); z.loginGoogle().catch(fail); },
        auWallet: () => !busy && this.setState({ auStep: 'wallet', auErr: '' }),
        auSubmit: () => { if (busy) return; if (!okEm) return this.setState({ auErr: 'Enter a valid email address' }); sendCode(); },
        auBack: () => this.setState({ auStep: 'main', auErr: '', auBusy: '', auCode: '' }),
        auBoxes: Array.from({ length: 6 }, (_, i) => ({ v: code[i] || '', bd: i === code.length ? 'var(--a)' : code[i] ? 'var(--t3)' : 'var(--l2)', sh: i === code.length ? '0 0 0 3px var(--at)' : 'none' })),
        auCode: code, onAuCode: e => { const v = e.target.value.replace(/\D/g, '').slice(0, 6); this.setState({ auCode: v, auErr: '' }); if (v.length === 6 && !busy) verify(v); },
        auVerify: () => code.length < 6 ? this.setState({ auErr: 'Enter the 6-digit code' }) : verify(code),
        auSentTo: em,
        auResendL: left ? `Resend in ${left}s` : 'Resend code', auResendC: left ? 'var(--t3)' : 'var(--a)', auResendCur: left ? 'default' : 'pointer',
        auResend: () => { if (left || busy) return; z.sendEmailCode(em).then(() => { this.setState({ auResendAt: Date.now() + 30000 }); const id = 'rs' + Date.now(); this.push({ id, kind: 'success', title: 'New code sent', body: em }); setTimeout(() => this.dismiss(id), 3500); }, fail); },
        auWallets: [['Phantom', WL.Phantom], ['Backpack', WL.Backpack], ['Solflare', WL.Solflare]].map(([name, logo]) => ({ name, logo, busy: busy === 'w' + name, idle: busy !== 'w' + name, pick: () => { if (busy) return; this.setState({ auBusy: 'w' + name, auErr: '' }); z.loginWallet(name).then(() => this.setState({ auBusy: '', auStep: 'main' }), fail); } })) };
    })();

    // leaderboard: devnet trading competition (no prizes), ranked by the engine from indexed fills
    const lbKey = s.lbWin + ':' + s.lbMetric, LB = store.leaderboard.get(lbKey), me = z.user ? z.user.owner : '', myRow = store.myRank.get(lbKey);
    if (s.page === 'leaderboard') store.loadLeaderboard(s.lbWin, s.lbMetric);
    const lbRow = r => { const np = Number(r.netPnl) / 1e6, you = r.owner === me; return { rank: String(r.rank), you, who: you ? 'You' : r.owner.slice(0, 4) + '…' + r.owner.slice(-4), href: K.addrUrlFor(r.owner), pnl: K.sUsd(np), pc: gc(np), roi: r.roi == null ? D : Math.abs(r.roi) < 5e-4 ? '0.0%' : K.pct(r.roi * 100, 1), rc: r.roi == null || Math.abs(r.roi) < 5e-4 ? 'var(--t3)' : gc(r.roi), vol: K.cpt(Number(r.volume) / 1e6), trades: K.num(r.trades, 0), bg: you ? 'var(--at)' : 'transparent', medal: r.rank <= 3 ? ['#F4B740', '#A0A8BA', '#C9824A'][r.rank - 1] : '', noMedal: r.rank > 3 }; };
    const seg = (on, extra) => ({ bg: on ? 'var(--h)' : 'transparent', color: on ? 'var(--t)' : 'var(--t3)', sh: on ? '0 1px 2px rgba(0,0,0,.25)' : 'none', ...extra });
    const lb = {
      lbWins: [['24h', '24h'], ['7d', '7D'], ['30d', '30D'], ['all', 'All time']].map(([id, label]) => seg(s.lbWin === id, { label, on: () => this.setState({ lbWin: id }) })),
      lbMetrics: [['pnl', 'PnL'], ['roi', 'ROI'], ['volume', 'Volume']].map(([id, label]) => seg(s.lbMetric === id, { label, on: () => this.setState({ lbMetric: id }) })),
      lbRows: LB ? LB.rows.map(lbRow) : [], lbLoading: !LB, lbHas: !!LB && LB.rows.length > 0, lbEmpty: !!LB && !LB.rows.length,
      lbMine: myRow ? lbRow(myRow) : null, lbShowMine: !!myRow && !(LB && LB.rows.some(r => r.owner === me)),
      lbNote: s.lbMetric === 'roi' ? `Return on deposits; traders with at least ${K.cpt(Number(LB ? LB.minVolumeForRoi : 1e9) / 1e6)} volume in the window` : s.lbMetric === 'volume' ? 'Traded notional in the window' : 'Net PnL after trading fees, borrow and funding',
      lbUpdated: LB ? 'Updated ' + K.age(Math.max(1, (now - LB.updatedAt) / 1000)) + ' ago' : '',
      lbJoin: conn && !myRow, lbGoTrade: () => this.go('trade'),
    };
    const out = { ...base, ...chrome, ...mk, ...form, ...cf, ...trade, ...tables, ...pf, ...vault, ...au, ...lb };
    ['mCount', 'mOI', 'mVol', 'mNav', 'mUtil', 'pfEquity', 'pfUpnl', 'pfReal', 'pfUsed', 'pfAvail', 'vNav', 'vPrice', 'vApr', 'vUtil', 'vYour', 'cfSize'].forEach(k => { out[k + 'P'] = K.parts(out[k]); });
    return out;
  }
}
