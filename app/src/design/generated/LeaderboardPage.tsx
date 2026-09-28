// Leaderboard page, written by hand in the design's language (not part of the original design export).
import { Fragment } from 'react';
import { sx, I, type V } from '../runtime';

const COLS = 'grid-template-columns:64px minmax(150px,1.6fr) minmax(110px,1fr) minmax(80px,.8fr) minmax(100px,1fr) minmax(64px,.6fr)';

function Row({ r }: { r: any }) {
  return (
    <div style={sx(`display:grid;${COLS};align-items:center;gap:14px;height:calc(var(--rh) + 10px);padding:0 16px;border-bottom:1px solid var(--l);background:${r?.bg ?? ''}`)}>
      <span style={sx("display:flex;align-items:center;gap:6px;font:600 13px 'Geist',sans-serif;font-variant-numeric:tabular-nums;color:var(--t2)")}>
        {r?.medal ? <span style={sx(`width:8px;height:8px;border-radius:50%;background:${r.medal};box-shadow:0 0 8px ${r.medal}`)} /> : null}
        {I(r?.rank)}
      </span>
      <a href={r?.href} target="_blank" rel="noreferrer" style={sx(`font:500 13px 'Geist Mono',monospace;color:${r?.you ? 'var(--a)' : 'var(--t)'};text-decoration:none;min-width:0;overflow:hidden;text-overflow:ellipsis`)}>
        {I(r?.who)}
      </a>
      <span style={sx(`text-align:right;font:500 13.5px 'Geist',sans-serif;font-variant-numeric:tabular-nums;color:${r?.pc ?? ''}`)}>{I(r?.pnl)}</span>
      <span style={sx(`text-align:right;font:500 13px 'Geist',sans-serif;font-variant-numeric:tabular-nums;color:${r?.rc ?? ''}`)}>{I(r?.roi)}</span>
      <span style={sx("text-align:right;font:500 13px 'Geist',sans-serif;font-variant-numeric:tabular-nums;color:var(--t)")}>{I(r?.vol)}</span>
      <span style={sx("text-align:right;font:500 13px 'Geist',sans-serif;font-variant-numeric:tabular-nums;color:var(--t2)")}>{I(r?.trades)}</span>
    </div>
  );
}

function Seg({ items }: { items: any[] }) {
  return (
    <div style={sx('display:inline-grid;grid-auto-flow:column;gap:3px;padding:3px;background:var(--in);border-radius:7px')}>
      {(Array.isArray(items) ? items : []).map((o: any, i: number) => (
        <Fragment key={i}>
          <button onClick={o?.on} style={sx(`height:28px;padding:0 12px;border-radius:5px;border:0;background:${o?.bg ?? ''};color:${o?.color ?? ''};box-shadow:${o?.sh ?? ''};font:600 12.5px 'Instrument Sans',sans-serif;cursor:pointer;white-space:nowrap`)} className="zp1">
            {I(o?.label)}
          </button>
        </Fragment>
      ))}
    </div>
  );
}

export function LeaderboardPage({ vm }: { vm: V }) {
  if (!vm.pLeaderboard) return null;
  return (
    <div style={sx('flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;animation:kpage .36s cubic-bezier(.16,1,.3,1)')}>
      <div style={sx(`max-width:1100px;margin:0 auto;padding:${vm.pagePad ?? ''};display:flex;flex-direction:column;gap:16px`)}>
        <div style={sx('display:flex;flex-direction:column;gap:6px')}>
          <h1 style={sx('margin:0;font-size:22px;font-weight:600;letter-spacing:-0.015em')}>Leaderboard</h1>
          <span style={sx('font-size:13px;color:var(--t2);line-height:1.5')}>
            Devnet trading competition, ranked from every fill on ZAP. No prizes: test USDC, real rankings.
          </span>
        </div>
        <div style={sx('display:flex;flex-wrap:wrap;align-items:center;gap:10px')}>
          <Seg items={vm.lbWins} />
          <Seg items={vm.lbMetrics} />
          <span style={sx('margin-left:auto;display:flex;flex-direction:column;align-items:flex-end;gap:2px;font-size:12px;color:var(--t3)')}>
            <span>{I(vm.lbNote)}</span>
            <span>{I(vm.lbUpdated)}</span>
          </span>
        </div>
        <div style={sx('background:var(--p);border:1px solid var(--l);border-radius:8px;overflow-x:auto')}>
          <div style={sx('min-width:620px')}>
            <div style={sx(`display:grid;${COLS};align-items:center;gap:14px;height:38px;padding:0 16px;border-bottom:1px solid var(--l);font-size:11.5px;color:var(--t3)`)}>
              <span>Rank</span>
              <span>Trader</span>
              <span style={sx('text-align:right')}>Net PnL</span>
              <span style={sx('text-align:right')}>ROI</span>
              <span style={sx('text-align:right')}>Volume</span>
              <span style={sx('text-align:right')}>Trades</span>
            </div>
            {vm.lbLoading
              ? [1, 2, 3, 4, 5].map((i) => (
                  <div key={i} style={sx(`display:grid;${COLS};align-items:center;gap:14px;height:calc(var(--rh) + 10px);padding:0 16px;border-bottom:1px solid var(--l)`)}>
                    {[28, 120, 70, 44, 60, 30].map((w, j) => (
                      <span key={j} style={sx(`height:10px;width:${w}px;border-radius:3px;background:var(--sk);justify-self:${j > 1 ? 'end' : 'start'}`)} />
                    ))}
                  </div>
                ))
              : null}
            {(Array.isArray(vm.lbRows) ? vm.lbRows : []).map((r: any, i: number) => (
              <Row key={i} r={r} />
            ))}
            {vm.lbShowMine ? (
              <>
                <div style={sx('height:8px;background:var(--in);border-bottom:1px solid var(--l)')} />
                <Row r={vm.lbMine} />
              </>
            ) : null}
            {vm.lbEmpty ? (
              <div style={sx('padding:40px 16px;display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center')}>
                <span style={sx('font-size:14px;font-weight:600')}>No ranked traders in this window yet</span>
                <span style={sx('font-size:12.5px;color:var(--t3)')}>Every trade counts. Open a position to get on the board.</span>
                <button onClick={vm.lbGoTrade} style={sx("margin-top:4px;height:34px;padding:0 16px;border-radius:6px;border:0;background:var(--af);color:var(--ai);font:600 13px 'Instrument Sans',sans-serif;cursor:pointer")} className="zp2">
                  Start trading
                </button>
              </div>
            ) : null}
          </div>
        </div>
        {vm.lbJoin && vm.lbHas ? <span style={sx('font-size:12.5px;color:var(--t3)')}>You're not ranked in this window yet. Trade to join the board.</span> : null}
      </div>
    </div>
  );
}
