// @ts-nocheck
// The terminal's data module: the same interface as the design prototype's mock module (keel-data.js), backed by the
// engine. Formatting, indicator math and chart geometry are the design's own code, kept verbatim; markets, prices,
// candles, trades, the vault and the trader's account come from the live store instead of seeded mocks.

import { store, marketList } from '../engine/store';

// Active-market parameters (the design read global constants; ZAP's fees and margins differ per market).
export let FEE = 0.0004, SPREAD = 0.00005, MMR = 0.005, MIN_SIZE = 10, MAX_UTIL = 80;
export function setActiveMarket(id) {
  const m = byId[id];
  if (!m) return;
  FEE = m.fee;
  SPREAD = m.spread;
  MMR = m.mmr;
}

export const sig = s => s;
const explorer = path => store.config?.cluster === 'localnet'
  ? `https://explorer.solana.com/${path}?cluster=custom&customUrl=${encodeURIComponent('http://localhost:8899')}`
  : `https://explorer.solana.com/${path}?cluster=devnet`;
export const txUrl = s => explorer(`tx/${s}`);
export const addrUrlFor = a => explorer(`address/${a}`);
export let ADDR = '';
export let addrUrl = '';
export function setAddress(a) {
  ADDR = a ?? '';
  addrUrl = addrUrlFor(ADDR);
}

const usd6 = v => Number(v ?? 0) / 1e6;
const px = t => (t ? Number(t.price) * 10 ** t.expo : 0);

/** Vault numbers for the vault page and headers: NAV, share price and APR from the engine, the rest from the pool. */
export const VAULT = { nav: 0, price: 1, apr: null, util: 0, withdrawable: 0, fees: 0, funding: 0, traders: 0 };

export const MARKETS = [];
export const byId = {};
export const live = { p: {}, dir: {}, at: {} };

function toMarket(v) {
  const on = v.onchain;
  const prm = on?.params ?? {};
  const assets = usd6(store.pool?.assets);
  const rate = on ? Number(on.fundingRate) * 3600 / 1e18 * 100 : 0;
  return {
    id: v.symbol, b: v.base, logo: v.logo, name: v.name, cat: v.category, max: v.maxLeverage, dec: v.priceDecimals,
    qd: v.sizeDecimals, price: px(store.prices.get(v.pythProFeedId)), c: v.color, rank: v.index + 1,
    oiL: usd6(on?.oiLong), oiS: usd6(on?.oiShort), fund: rate, vol: usd6(v.stats?.volume24h),
    capL: assets * Number(prm.oiCapLongBps ?? 0) / 1e4, capS: assets * Number(prm.oiCapShortBps ?? 0) / 1e4,
    status: on?.status === 2 ? 'PAUSED' : on?.status === 1 ? 'REDUCE-ONLY' : undefined,
    stale: store.oracleAgeMs > 10_000 ? 1 : undefined,
    fee: Number(prm.openFeeBps ?? 4) / 1e4, closeFee: Number(prm.closeFeeBps ?? 4) / 1e4, mmr: Number(prm.mmrBps ?? 50) / 1e4,
    spread: Number(prm.minSpreadFrac ?? 0) / 1e12, maxPosition: usd6(prm.maxPositionUsd),
    index: v.index, feedId: v.pythProFeedId,
  };
}

function sync() {
  const list = marketList().map(toMarket);
  MARKETS.length = 0;
  MARKETS.push(...list);
  for (const k of Object.keys(byId)) delete byId[k];
  for (const m of list) byId[m.id] = m;
  const now = Date.now();
  for (const m of list) {
    const t = store.prices.get(m.feedId);
    if (!t) continue;
    live.p[m.id] = px(t);
    const d = store.dir.get(m.feedId);
    live.dir[m.id] = d?.d ?? 0;
    live.at[m.id] = d?.at ?? now - 5_000;
  }
  const pool = store.pool;
  if (pool) {
    const assets = usd6(pool.assets), v = store.vault;
    VAULT.nav = v ? usd6(v.nav) : assets;
    VAULT.price = v?.sharePrice ?? (Number(pool.lpSupply) ? (assets + 1) / (usd6(pool.lpSupply) + 1) : 1);
    VAULT.apr = v?.apr ?? null;
    VAULT.util = assets ? usd6(pool.reserved) / assets * 100 : 0;
    VAULT.withdrawable = v ? usd6(v.withdrawable) : Math.max(0, assets - usd6(pool.reserved));
    VAULT.fees = usd6(pool.cumTradingFees) + usd6(pool.cumBorrowFees) + usd6(pool.cumLiquidationFees);
    VAULT.funding = Number(pool.cumFundingNet ?? 0) / 1e6;
    VAULT.traders = -Number(pool.cumTraderPnl ?? 0) / 1e6;
  }
  const params = store.config?.protocol?.params;
  if (params) {
    MIN_SIZE = usd6(params.minOrderUsd);
    MAX_UTIL = Number(params.maxUtilBps) / 100;
  }
}
store.subscribe(sync);
sync();

export const PRESETS = { 100: [1, 10, 25, 50, 100], 50: [1, 5, 10, 25, 50], 20: [1, 2, 5, 10, 20] };

const NF = {}; const nf = d => NF[d] || (NF[d] = new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const SUBS = '₀₁₂₃₄₅₆₇₈₉';
export const num = (n, d = 2) => { const a = Math.abs(n); if (d >= 6 && a > 0 && a < 0.001) { const fr = a.toFixed(d).split('.')[1], z = fr.match(/^0*/)[0].length; return (n < 0 ? '−' : '') + '0.0' + String(z).split('').map(c => SUBS[c]).join('') + fr.slice(z); } return nf(d).format(n); };
export const usd = (n, d = 2) => (n < 0 ? '−$' : '$') + num(Math.abs(n), d);
export const sUsd = (n, d = 2) => (n < 0 ? '−$' : '+$') + num(Math.abs(n), d);
export const pct = (n, d = 2) => (n < 0 ? '−' : n > 0 ? '+' : '') + num(Math.abs(n), d) + '%';
const CF = new Intl.NumberFormat('en-US', { notation: 'compact', maximumSignificantDigits: 3 });
export const cpt = n => (n < 0 ? '−$' : '$') + CF.format(Math.abs(n));
export function parts(str) {
  const m = /^([+−-]?)(\$?)([\d,]+)(\.[\d₀-₉]+)?(.*)$/.exec(String(str));
  if (!m) return { sg: '', c: '', i: String(str), f: '', z: '', f2: '', u: '' };
  let [, sg, c, i, f = '', u] = m, z = '', f2 = ''; u = u.trim();
  const zi = f.search(/[₀-₉]/);
  if (zi >= 0) { const zs = f.slice(zi).match(/^[₀-₉]+/)[0]; z = zs.split('').map(ch => SUBS.indexOf(ch)).join(''); f2 = f.slice(zi + zs.length); f = f.slice(0, zi); }
  else if (!(c && !/^[KMBT]/.test(u))) { i += f; f = ''; }
  return { sg, c, i, f, z, f2, u };
}
/** Seconds since the market's latest oracle price was published. */
export const ageOf = id => { const t = store.prices.get(byId[id]?.feedId); return t ? Math.max(0, Date.now() / 1000 - Number(t.tsUs) / 1e6) : Infinity; };
export const age = s => !Number.isFinite(s) ? '—' : s < 60 ? Math.max(1, Math.round(s)) + 's' : s < 3600 ? Math.floor(s / 60) + 'm' : Math.floor(s / 3600) + 'h';
export const hms = t => new Date(t).toISOString().slice(11, 19);
export const fdt = t => { const d = new Date(t); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) + ' ' + d.toISOString().slice(11, 16); };
/** Liquidation price for a design-shaped position (`entry`, `size`, `margin`, `side`), with the market's maintenance margin and close fee. */
export const liqOf = p => {
  const m = byId[p.market];
  const mmr = m?.mmr ?? MMR, fc = m?.closeFee ?? FEE, owed = p.owed ?? 0;
  const u = p.size / p.entry;
  return p.side === 'long'
    ? Math.max(0, (p.size * (1 + mmr) - p.margin + owed) / (u * (1 - fc)))
    : (p.margin + p.size * (1 - mmr) - owed) / (u * (1 + fc));
};
export const pnlOf = (p, mark) => (p.size / p.entry) * (p.side === 'long' ? mark - p.entry : p.entry - mark);

export const TF = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '6h': 21600, '1D': 86400 };
const requested = new Set();
/** Candles from the engine (12-decimal prices → numbers); the live price stands in until they load. */
export function candles(id, tf) {
  const m = byId[id];
  if (!m) return [];
  const key = `${m.index}:${TF[tf]}`;
  const rows = store.candles.get(key);
  const bucket = Math.floor(Date.now() / 1000 / TF[tf]) * TF[tf];
  if (!requested.has(key + bucket)) {
    requested.add(key + bucket);
    void store.loadCandles(m.index, TF[tf]);
  }
  if (!rows?.length) {
    const p = live.p[id] ?? m.price;
    return [{ t: bucket * 1000, o: p, h: p, l: p, c: p, v: 0 }];
  }
  return rows.map(r => ({ t: r.t * 1000, o: Number(r.o) / 1e12, h: Number(r.h) / 1e12, l: Number(r.l) / 1e12, c: Number(r.c) / 1e12, v: Number(r.v) / 1e6 }));
}
/** 24h stats: the open from the engine (or the oldest candle while history is shorter), range and sparkline. */
export function stats(id) {
  const cs = candles(id, '15m').slice(-96);
  const step = Math.max(1, Math.floor(cs.length / 24));
  const st = store.markets.get(byId[id]?.index)?.stats;
  const open = st?.open24h ? Number(st.open24h) / 1e12 : cs[0].o;
  const since = st?.open24h ? st.openAt : cs[0].t;
  const span = since && Date.now() - since < 23.5 * 3600e3 ? age((Date.now() - since) / 1000) : '24h';
  return { open, hi: Math.max(...cs.map(c => c.h)), lo: Math.min(...cs.map(c => c.l)), span, spark: cs.filter((c, i) => i % step === 0).map(c => c.c) };
}
export function spark(vals, w = 80, h = 24) { const lo = Math.min(...vals), hi = Math.max(...vals), d = hi - lo || 1; return vals.map((v, i) => (i / (vals.length - 1) * w).toFixed(1) + ',' + (h - 2 - (v - lo) / d * (h - 4)).toFixed(1)).join(' '); }
const nice = x => { const e = Math.pow(10, Math.floor(Math.log10(x))), f = x / e; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * e; };
const tlabel = (t, tf) => { const d = new Date(t); return tf === '1D' || tf === '6h' ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : d.toISOString().slice(11, 16); };
export const IND_COLORS = ['#F0B90B', '#E056FD', '#3DC7F5', '#FF7A45', '#7CD992', '#A78BFA', '#F472B6', '#E5E7EB'];
export const IND_CATS = ['Trend', 'Momentum', 'Volatility', 'Volume'];
export const IND = {
  ma: { name: 'Moving Average', short: 'MA', cat: 'Trend', pane: 'main', desc: 'Simple average of the last N candles', params: [['len', 'Length', 20], ['src', 'Source', 'close']], lines: [['v', 'MA']], colors: ['#F0B90B'] },
  ema: { name: 'Exponential Moving Average', short: 'EMA', cat: 'Trend', pane: 'main', desc: 'Weighted average that reacts faster to new prices', params: [['len', 'Length', 50], ['src', 'Source', 'close']], lines: [['v', 'EMA']], colors: ['#E056FD'] },
  bb: { name: 'Bollinger Bands', short: 'BB', cat: 'Volatility', pane: 'main', desc: 'Moving average with standard-deviation bands', params: [['len', 'Length', 20], ['mult', 'StdDev', 2], ['src', 'Source', 'close']], lines: [['u', 'Upper'], ['m', 'Basis'], ['l', 'Lower']], colors: ['#3DC7F5', '#FF7A45', '#3DC7F5'] },
  sar: { name: 'Parabolic SAR', short: 'SAR', cat: 'Trend', pane: 'main', desc: 'Trailing stop-and-reverse dots', params: [['step', 'Step', 0.02], ['max', 'Max', 0.2]], lines: [['v', 'SAR']], colors: ['#A78BFA'] },
  vwap: { name: 'VWAP', short: 'VWAP', cat: 'Volume', pane: 'main', desc: 'Volume-weighted average price, resets daily (UTC)', params: [], lines: [['v', 'VWAP']], colors: ['#F472B6'] },
  vol: { name: 'Volume', short: 'VOL', cat: 'Volume', pane: 'main', desc: 'Traded volume per candle, with an optional average', params: [['len', 'MA length (0 = off)', 0]], lines: [['ma', 'MA']], colors: ['#E5E7EB'] },
  rsi: { name: 'Relative Strength Index', short: 'RSI', cat: 'Momentum', pane: 'sub', desc: 'Momentum from 0 to 100; 70 overbought, 30 oversold', params: [['len', 'Length', 14], ['src', 'Source', 'close']], lines: [['v', 'RSI']], colors: ['#A78BFA'], levels: [70, 30], fixed: [0, 100] },
  macd: { name: 'MACD', short: 'MACD', cat: 'Momentum', pane: 'sub', desc: 'Difference of two EMAs with a signal line and histogram', params: [['fast', 'Fast', 12], ['slow', 'Slow', 26], ['sig', 'Signal', 9], ['src', 'Source', 'close']], lines: [['m', 'DIF'], ['s', 'DEA'], ['h', 'Hist']], colors: ['#3DC7F5', '#FF7A45', null], zero: 1 },
  kdj: { name: 'KDJ', short: 'KDJ', cat: 'Momentum', pane: 'sub', desc: 'Stochastic oscillator with a leading J line', params: [['len', 'Period', 9], ['k', 'K smoothing', 3], ['d', 'D smoothing', 3]], lines: [['k', 'K'], ['d', 'D'], ['j', 'J']], colors: ['#F0B90B', '#3DC7F5', '#E056FD'], levels: [80, 20], fixed: [0, 100] },
  stochrsi: { name: 'Stochastic RSI', short: 'StochRSI', cat: 'Momentum', pane: 'sub', desc: 'Stochastic oscillator applied to RSI', params: [['rsi', 'RSI length', 14], ['len', 'Stoch length', 14], ['k', 'K', 3], ['d', 'D', 3]], lines: [['k', 'K'], ['d', 'D']], colors: ['#3DC7F5', '#FF7A45'], levels: [80, 20], fixed: [0, 100] },
  atr: { name: 'Average True Range', short: 'ATR', cat: 'Volatility', pane: 'sub', desc: 'Average candle range, a measure of volatility', params: [['len', 'Length', 14]], lines: [['v', 'ATR']], colors: ['#FF7A45'] },
};
const iSma = (a, n) => { const o = Array(a.length).fill(null); let s = 0, c = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; if (v == null) { s = 0; c = 0; continue; } s += v; c++; if (c > n) { s -= a[i - n]; c = n; } if (c === n) o[i] = s / n; } return o; };
const iEma = (a, n) => { const o = Array(a.length).fill(null), k = 2 / (n + 1); let e = null, c = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; if (v == null) continue; c++; e = e == null ? v : v * k + e * (1 - k); if (c >= n) o[i] = e; } return o; };
const iRsi = (a, n) => { const o = Array(a.length).fill(null); let ag = 0, al = 0, c = 0, pv = null; for (let i = 0; i < a.length; i++) { const v = a[i]; if (v == null) continue; if (pv == null) { pv = v; continue; } const dd = v - pv, g = dd > 0 ? dd : 0, l = dd < 0 ? -dd : 0; pv = v; c++; if (c <= n) { ag += g / n; al += l / n; } else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; } if (c >= n) o[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); } return o; };
const iWin = (a, n, f) => a.map((v, i) => { if (i < n - 1) return null; let r = null; for (let j = i - n + 1; j <= i; j++) { const x = a[j]; if (x == null) return null; r = r == null ? x : f(r, x); } return r; });
export function indicator(t, p, all) {
  const P = (k, def, min = 1) => { const v = parseFloat(p && p[k]); return Number.isFinite(v) && v >= min ? v : def; }, L = k => Math.round(P(k, (IND[t].params.find(q => q[0] === k) || [0, 0, 1])[2]));
  const sk = (p && p.src) || 'close', src = all.map(c => sk === 'open' ? c.o : sk === 'high' ? c.h : sk === 'low' ? c.l : sk === 'hl2' ? (c.h + c.l) / 2 : sk === 'hlc3' ? (c.h + c.l + c.c) / 3 : c.c);
  const hi = all.map(c => c.h), lo = all.map(c => c.l), cl = all.map(c => c.c);
  if (t === 'ma') return { v: iSma(src, L('len')) };
  if (t === 'ema') return { v: iEma(src, L('len')) };
  if (t === 'bb') { const n = L('len'), k = P('mult', 2, 0.1), m = iSma(src, n), u = [], l = []; src.forEach((c, i) => { if (m[i] == null) { u.push(null); l.push(null); return; } let s = 0; for (let j = i - n + 1; j <= i; j++) s += (src[j] - m[i]) ** 2; const sd = Math.sqrt(s / n); u.push(m[i] + k * sd); l.push(m[i] - k * sd); }); return { u, m, l }; }
  if (t === 'vwap') { let d0 = null, pv = 0, vv = 0; return { v: all.map(c => { const dd = Math.floor(c.t / 864e5); if (dd !== d0) { d0 = dd; pv = 0; vv = 0; } const v = c.v || 0; pv += (c.h + c.l + c.c) / 3 * v; vv += v; return vv ? pv / vv : (c.h + c.l + c.c) / 3; }) }; }
  if (t === 'vol') { const n = Math.round(P('len', 0, 0)); return n > 0 ? { ma: iSma(all.map(c => c.v || 0), n) } : {}; }
  if (t === 'sar') { const st = P('step', .02, .001), mx = P('max', .2, .01), o = Array(all.length).fill(null); if (all.length < 3) return { v: o }; let up = all[1].c >= all[0].c, af = st, ep = up ? all[0].h : all[0].l, sar = up ? all[0].l : all[0].h; for (let i = 1; i < all.length; i++) { sar = sar + af * (ep - sar); if (up) { sar = Math.min(sar, lo[i - 1], lo[Math.max(0, i - 2)]); if (lo[i] < sar) { up = false; sar = ep; ep = lo[i]; af = st; } else if (hi[i] > ep) { ep = hi[i]; af = Math.min(mx, af + st); } } else { sar = Math.max(sar, hi[i - 1], hi[Math.max(0, i - 2)]); if (hi[i] > sar) { up = true; sar = ep; ep = hi[i]; af = st; } else if (lo[i] < ep) { ep = lo[i]; af = Math.min(mx, af + st); } } o[i] = sar; } return { v: o }; }
  if (t === 'rsi') return { v: iRsi(src, L('len')) };
  if (t === 'macd') { const f = iEma(src, L('fast')), s = iEma(src, L('slow')), m = f.map((v, i) => v == null || s[i] == null ? null : v - s[i]), g = iEma(m, L('sig')); return { m, s: g, h: m.map((v, i) => v == null || g[i] == null ? null : v - g[i]) }; }
  if (t === 'kdj') { const n = L('len'), ks = L('k'), ds = L('d'), HH = iWin(hi, n, Math.max), LL = iWin(lo, n, Math.min); let K = 50, D = 50; const k = [], dd = [], j = []; cl.forEach((c, i) => { if (HH[i] == null) { k.push(null); dd.push(null); j.push(null); return; } const rsv = HH[i] === LL[i] ? 50 : (c - LL[i]) / (HH[i] - LL[i]) * 100; K = ((ks - 1) * K + rsv) / ks; D = ((ds - 1) * D + K) / ds; k.push(K); dd.push(D); j.push(3 * K - 2 * D); }); return { k, d: dd, j }; }
  if (t === 'stochrsi') { const r = iRsi(src, L('rsi')), n = L('len'), H = iWin(r, n, Math.max), Lw = iWin(r, n, Math.min), st = r.map((v, i) => v == null || H[i] == null ? null : H[i] === Lw[i] ? 50 : (v - Lw[i]) / (H[i] - Lw[i]) * 100), k = iSma(st, L('k')); return { k, d: iSma(k, L('d')) }; }
  if (t === 'atr') { const n = L('len'), tr = all.map((c, i) => i ? Math.max(c.h - c.l, Math.abs(c.h - all[i - 1].c), Math.abs(c.l - all[i - 1].c)) : c.h - c.l), o = Array(all.length).fill(null); let a = 0; tr.forEach((v, i) => { if (i < n) { a += v / n; if (i === n - 1) o[i] = a; } else { a = (a * (n - 1) + v) / n; o[i] = a; } }); return { v: o }; }
  return {};
}
export function chart(id, tf, lp, lines, stale, o = {}) {
  const m = byId[id], src = candles(id, tf), N = src.length, all = src.slice();
  const L0 = { ...all[N - 1] }; L0.c = lp; L0.h = Math.max(L0.h, lp); L0.l = Math.min(L0.l, lp); all[N - 1] = L0;
  const count = Math.max(Math.min(12, N), Math.min(N, Math.round(o.count || 96)));
  const follow = o.end == null || o.end >= N - 1;
  const end = follow ? N - 1 : Math.max(Math.min(count, N) - 1, Math.round(o.end));
  const start = Math.max(0, end - count + 1), vis = all.slice(start, end + 1), n = vis.length;
  const slots = n + (follow ? Math.max(3, Math.round(n * .06)) : 1);
  const closes = all.map(c => c.c), ind = o.ind || {}, iq = o.inds || [], indv = iq.map(q => indicator(q.t, q.p, all));
  const sma = p => { let s = 0; return closes.map((c, i) => { s += c; if (i >= p) s -= closes[i - p]; return i >= p - 1 ? s / p : null; }); };
  const ema = p => { const k = 2 / (p + 1); let e = null; return closes.map((c, i) => { e = e == null ? c : c * k + e * (1 - k); return i >= p - 1 ? e : null; }); };
  const ma = ind.ma ? sma(20) : null, em = ind.ema ? ema(50) : null;
  let bbM = null, bbU = null, bbL = null;
  if (ind.bb) { bbM = sma(20); bbU = []; bbL = []; closes.forEach((c, i) => { if (bbM[i] == null) { bbU.push(null); bbL.push(null); return; } let v = 0; for (let j = i - 19; j <= i; j++) v += (closes[j] - bbM[i]) ** 2; const sd = Math.sqrt(v / 20); bbU.push(bbM[i] + 2 * sd); bbL.push(bbM[i] - 2 * sd); }); }
  let rsi = null;
  if (ind.rsi) { rsi = [null]; let ag = 0, al = 0; for (let i = 1; i < N; i++) { const d = closes[i] - closes[i - 1], g = d > 0 ? d : 0, l = d < 0 ? -d : 0; if (i <= 14) { ag += g / 14; al += l / 14; } else { ag = (ag * 13 + g) / 14; al = (al * 13 + l) / 14; } rsi.push(i < 14 ? null : 100 - 100 / (1 + ag / (al || 1e-12))); } }
  let lo = Infinity, hi = -Infinity;
  vis.forEach(c => { if (c.l < lo) lo = c.l; if (c.h > hi) hi = c.h; });
  if (bbU) for (let i = start; i <= end; i++) if (bbU[i] != null) { lo = Math.min(lo, bbL[i]); hi = Math.max(hi, bbU[i]); }
  iq.forEach((q, qi) => { if (q.hidden || q.t === 'vol' || !IND[q.t] || IND[q.t].pane !== 'main') return; const r = indv[qi]; for (const k in r) { const a = r[k]; for (let i = start; i <= end; i++) if (a[i] != null) { lo = Math.min(lo, a[i]); hi = Math.max(hi, a[i]); } } });
  [ma, em].forEach(a => { if (a) for (let i = start; i <= end; i++) if (a[i] != null) { lo = Math.min(lo, a[i]); hi = Math.max(hi, a[i]); } });
  const pd = (hi - lo) * .08 || hi * .01; lo -= pd; hi += pd;
  const W = 1000, H = 400, cw = W / slots, bw = Math.max(1, cw * .64), f = v => v.toFixed(1);
  const y = p => H * (1 - (p - lo) / (hi - lo)), X = i => (i - start + .5) * cw;
  let up = '', dn = '', wu = '', wd = '', bu = '', bd = '', ln = '', py = '', vu = '', vd = '', pv = 0;
  const frozen = stale ? Math.floor(N * .97) : N, vmax = Math.max(...vis.map(c => c.v || 0)) || 1;
  const pys = all.map((c, i) => { if (i < frozen) pv = i === N - 1 ? lp : c.c; return pv; });
  vis.forEach((c, k) => {
    const i = start + k, x = X(i), u = c.c >= c.o, yt = y(Math.max(c.o, c.c)), yb = Math.max(y(Math.min(c.o, c.c)), yt + 1);
    const b = `M${f(x - bw / 2)} ${f(yt)}H${f(x + bw / 2)}V${f(yb)}H${f(x - bw / 2)}Z`, w = `M${f(x)} ${f(y(c.h))}V${f(yt)}M${f(x)} ${f(yb)}V${f(y(c.l))}`;
    const br = `M${f(x)} ${f(y(c.h))}V${f(y(c.l))}M${f(x - bw / 2)} ${f(y(c.o))}H${f(x)}M${f(x)} ${f(y(c.c))}H${f(x + bw / 2)}`;
    if (u) { up += b; wu += w; bu += br; } else { dn += b; wd += w; bd += br; }
    ln += (k ? 'L' : 'M') + f(x) + ' ' + f(y(c.c));
    const vh = (c.v || 0) / vmax * H * .18, vb = `M${f(x - bw / 2)} ${f(H - vh)}H${f(x + bw / 2)}V${H}H${f(x - bw / 2)}Z`;
    if (u) vu += vb; else vd += vb;
    py += k ? `H${f(x)}V${f(y(pys[i]))}` : `M${f(x - cw / 2)} ${f(y(pys[i]))}H${f(x)}`;
  });
  if (follow) py += `H${f((n + .5) * cw)}`;
  const la = ln + `L${f(X(end))} ${H}L${f(X(start))} ${H}Z`;
  const ser = (arr, yy) => { let d = '', pen = false; for (let i = start; i <= end; i++) { const v = arr[i]; if (v == null) { pen = false; continue; } d += (pen ? 'L' : 'M') + f(X(i)) + ' ' + f(yy(v)); pen = true; } return d; };
  const maP = ma ? ser(ma, y) : '', emP = em ? ser(em, y) : '', bbUP = bbU ? ser(bbU, y) : '', bbLP = bbL ? ser(bbL, y) : '', bbMP = bbM ? ser(bbM, y) : '';
  let bbF = '';
  if (bbU) { const pts = []; for (let i = start; i <= end; i++) if (bbU[i] != null) pts.push([X(i), y(bbU[i]), y(bbL[i])]); if (pts.length > 1) bbF = 'M' + pts.map(p => f(p[0]) + ' ' + f(p[1])).join('L') + 'L' + pts.slice().reverse().map(p => f(p[0]) + ' ' + f(p[2])).join('L') + 'Z'; }
  const rsiP = rsi ? ser(rsi, v => 100 - v) : '';
  const step = nice((hi - lo) / 6), dd = Math.min(m.dec, Math.max(0, Math.ceil(-Math.log10(step)))), grid = [];
  for (let k = Math.ceil(lo / step); k * step <= hi; k++) grid.push({ top: (y(k * step) / H * 100).toFixed(2) + '%', label: num(k * step, dd) });
  const xl = [], ev = Math.max(1, Math.round(n / 6));
  for (let k = n - 1 - ev; k >= 0; k -= ev) xl.push({ left: ((k + .5) / slots * 100).toFixed(2) + '%', label: tlabel(vis[k].t, tf) });
  const inl = [], pinsTop = [], pinsBot = [];
  (lines || []).forEach(q => { const t = y(q.p) / H, oo = { ...q, top: (Math.min(Math.max(t, 0), 1) * 100).toFixed(2) + '%', price: num(q.p, m.dec), rx: '8px' }; (t < 0 ? pinsTop : t > 1 ? pinsBot : inl).push(oo); });
  const at = k => { const i = start + k; return { ma: ma ? ma[i] : null, ema: em ? em[i] : null, bbU: bbU ? bbU[i] : null, bbM: bbM ? bbM[i] : null, bbL: bbL ? bbL[i] : null, rsi: rsi ? rsi[i] : null, v: all[i] ? all[i].v : null }; };
  return { indv, vmax, la, up, dn, wu, wd, bu, bd, ln, py, vu, vd, maP, emP, bbUP, bbLP, bbMP, bbF, rsiP, grid, xl, inl, pinsTop, pinsBot, cs: vis, n, slots, lo, hi, start, end, N, t0: all[0].t, all, at, follow, lastTop: (y(lp) / H * 100).toFixed(2) + '%', lastUp: L0.c >= L0.o, tl: t => tlabel(t, tf === '1D' || tf === '6h' ? tf : '15m') };
}
export function area(vals, W = 1000, H = 200) { const lo = Math.min(...vals), hi = Math.max(...vals), d = (hi - lo) || 1; const pts = vals.map((v, i) => (i / (vals.length - 1) * W).toFixed(1) + ' ' + (H - 10 - (v - lo) / d * (H - 30)).toFixed(1)); const line = 'M' + pts.join('L'); return { line, fill: line + `L${W} ${H}L0 ${H}Z`, lo, hi }; }

/** Recent ZAP fills on a market (the engine streams new ones). */
export function trades(id) {
  const m = byId[id];
  if (!m) return [];
  store.watchTrades(m.index);
  return (store.trades.get(m.index) ?? []).map(t => {
    const opening = [0, 5, 6].includes(t.kind);
    const buy = (t.side === 0) === opening;
    return { buy, p: Number(t.fill_price) / 1e12, usd: Math.abs(Number(t.size_delta)) / 1e6, t: Number(t.ts) * 1000, sig: t.sig };
  });
}

export function subscribe(f) { return store.subscribe(f); }
export const flash = id => Date.now() - (live.at[id] ?? 0) < 700 ? (live.dir[id] > 0 ? 'up' : 'down') : '';

