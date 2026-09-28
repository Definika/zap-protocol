// "Enable trading" and "Deposit / withdraw": the two wallet-signed flows, in the terminal's design language.
// Enabling trading is one signature: create the trading account with a 1-click session key and deposit (after test USDC
// from the faucet if the wallet needs it). Everything after that is signed by the session key and paid by ZAP.

import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { sx } from '../design/runtime';
import { describeError } from '../engine/tx';
import { store } from '../engine/store';
import { num, txUrl } from './keel';
import { useZap } from '../wallet/zap';

const fmt = (n: number, d = 2) => num(n, d);
const clean = (v: string) => v.replace(/[^0-9.]/g, '');

function Modal({ onClose, title, sub, children }: { onClose(): void; title: string; sub?: string; children: ReactNode }) {
  return (
    <div onClick={onClose} style={sx('position:absolute;inset:0;z-index:72;background:var(--ov);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:16px;animation:kfade .18s ease-out')}>
      <div onClick={(e) => e.stopPropagation()} style={sx('width:400px;max-width:100%;max-height:100%;background:var(--p);border:1px solid var(--l2);border-radius:12px;box-shadow:var(--sh);overflow:auto;overscroll-behavior:contain;animation:kmodal .38s cubic-bezier(.16,1,.3,1)')}>
        <div style={sx('padding:18px 20px 16px;display:flex;justify-content:space-between;align-items:flex-start;gap:12px;border-bottom:1px solid var(--l);background:linear-gradient(180deg,var(--at),transparent 90%)')}>
          <div style={sx('display:flex;flex-direction:column;gap:5px')}>
            <span style={sx('font-size:19px;font-weight:600')}>{title}</span>
            {sub ? <span style={sx('font-size:12.5px;line-height:1.5;color:var(--t2)')}>{sub}</span> : null}
          </div>
          <button onClick={onClose} style={sx('width:28px;height:28px;flex:none;border-radius:6px;border:0;background:var(--r);color:var(--t2);display:grid;place-items:center;cursor:pointer')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div style={sx('padding:16px 20px 20px;display:flex;flex-direction:column;gap:14px')}>{children}</div>
      </div>
    </div>
  );
}

function Amount({ value, onChange, onMax, label, balance }: { value: string; onChange(v: string): void; onMax(): void; label: string; balance: string }) {
  const [focus, setFocus] = useState(false);
  return (
    <>
      <div style={sx('display:flex;justify-content:space-between;gap:8px;font-size:12px;color:var(--t3);white-space:nowrap')}>
        <span>Amount</span>
        <span>
          {label}{' '}
          <span style={sx("font-family:'Geist',sans-serif;font-variant-numeric:tabular-nums;color:var(--t)")}>{balance}</span>
        </span>
      </div>
      <label style={sx(`height:46px;box-sizing:border-box;display:flex;align-items:center;gap:8px;padding:0 8px 0 12px;background:var(--in);border:1px solid ${focus ? 'var(--a)' : 'var(--l2)'};border-radius:6px;box-shadow:${focus ? '0 0 0 3px var(--at)' : 'none'};transition:border-color .15s,box-shadow .15s`)}>
        <input value={value} onChange={(e) => onChange(clean(e.target.value))} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} placeholder="0.00" inputMode="decimal" style={sx("flex:1;min-width:0;background:none;border:0;outline:none;color:var(--t);font:500 17px 'Geist',sans-serif;font-variant-numeric:tabular-nums")} />
        <span style={sx('display:flex;align-items:center;gap:6px;font-size:12px;color:var(--t2)')}>
          <span style={sx('width:16px;height:16px;border-radius:50%;background:url("/logos/usdc.png") center/cover')} />
          USDC
        </span>
        <button onClick={onMax} style={sx("height:28px;padding:0 9px;border-radius:5px;border:1px solid var(--l2);background:var(--r);color:var(--t2);font:500 11.5px 'Geist',sans-serif;cursor:pointer")} className="zpe">
          Max
        </button>
      </label>
    </>
  );
}

function Action({ busy, label, reason, onClick }: { busy: string; label: string; reason: string; onClick(): void }) {
  if (busy)
    return (
      <div style={sx("height:46px;box-sizing:border-box;border-radius:7px;background:var(--at);color:var(--t);font:600 13.5px 'Instrument Sans',sans-serif;display:flex;align-items:center;justify-content:center;gap:10px")}>
        <span style={sx('width:14px;height:14px;box-sizing:border-box;border-radius:50%;border:2px solid var(--l2);border-top-color:currentColor;animation:kspin .8s linear infinite;display:inline-block')} />
        {busy}
      </div>
    );
  if (reason)
    return (
      <div style={sx("height:46px;box-sizing:border-box;border-radius:7px;border:1px dashed var(--l2);background:var(--in);color:var(--t3);font:500 12.5px 'Instrument Sans',sans-serif;display:grid;place-items:center")}>
        {reason}
      </div>
    );
  return (
    <button onClick={onClick} style={sx("height:46px;border-radius:7px;border:0;background:var(--af);color:var(--ai);font:600 14px 'Instrument Sans',sans-serif;cursor:pointer;transition:filter .15s,transform .1s")} className="zp2 zpp">
      {label}
    </button>
  );
}

function Note({ kind, children }: { kind: 'error' | 'ok' | 'info'; children: ReactNode }) {
  const c = kind === 'error' ? ['var(--rt)', 'var(--rd)'] : kind === 'ok' ? ['var(--gt)', 'var(--g)'] : ['var(--in)', 'var(--t2)'];
  return <div style={sx(`padding:10px 12px;border-radius:6px;background:${c[0]};color:${c[1]};font-size:12.5px;line-height:1.5`)}>{children}</div>;
}

function Step({ n, title, sub, done }: { n: number; title: string; sub: string; done?: boolean }) {
  return (
    <div style={sx('display:flex;gap:12px;align-items:flex-start')}>
      <span style={sx(`width:24px;height:24px;flex:none;border-radius:50%;display:grid;place-items:center;font:600 12px 'Geist',sans-serif;background:${done ? 'var(--gt)' : 'var(--r)'};color:${done ? 'var(--g)' : 'var(--t2)'}`)}>
        {done ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12l5 5 9-10" />
          </svg>
        ) : (
          n
        )}
      </span>
      <span style={sx('display:flex;flex-direction:column;gap:2px;padding-top:3px')}>
        <span style={sx('font-size:13px;font-weight:600')}>{title}</span>
        <span style={sx('font-size:12px;color:var(--t3);line-height:1.45')}>{sub}</span>
      </span>
    </div>
  );
}

export function EnableTradingModal() {
  const z = useZap();
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const open = z.ui.enableOpen && !!z.user;
  const wallet = z.walletUsdc ?? 0;
  const canFaucet = z.faucetReadyAt != null && z.faucetReadyAt <= Date.now();
  const suggested = wallet > 0 ? Math.floor(wallet * 100) / 100 : canFaucet ? z.faucetAmount : 0;

  useEffect(() => {
    if (open) {
      setAmount(suggested ? String(suggested) : '');
      setError('');
    }
    // only when the modal opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  const a = Number(amount) || 0;
  const needsFaucet = a > wallet;
  const reason = a > wallet && !canFaucet ? `Your wallet has ${fmt(wallet)} USDC` : '';
  const renew = z.hasAccount;
  const go = () => {
    setError('');
    setBusy('Starting…');
    z.ui
      .enableTrading(a, setBusy)
      .then(() => {
        setBusy('');
        z.ui.closeEnable();
      })
      .catch((e: unknown) => {
        setBusy('');
        setError(describeError(e));
      });
  };

  return (
    <Modal
      onClose={() => !busy && z.ui.closeEnable()}
      title={renew ? 'Turn on 1-click trading' : 'Enable trading'}
      sub={renew ? 'One signature gives this browser a new trading key. Trades then confirm without wallet pop-ups.' : 'One signature sets up your ZAP account. After that, trades confirm instantly: no wallet pop-ups, and ZAP pays every network fee.'}
    >
      <div style={sx('display:flex;flex-direction:column;gap:12px')}>
        {!renew ? (
          <Step n={1} title="Test USDC" done={!needsFaucet} sub={needsFaucet ? `${fmt(z.faucetAmount, 0)} devnet USDC from the faucet, free once a day` : `Your wallet has ${fmt(wallet)} USDC`} />
        ) : null}
        <Step n={renew ? 1 : 2} title={renew ? 'New trading key' : 'Trading account + 1-click key'} sub="The key stays in this browser for 7 days. It can trade, never withdraw." />
        <Step n={renew ? 2 : 3} title="Deposit" sub="Moves USDC from your wallet into your trading balance" />
      </div>
      <Amount value={amount} onChange={setAmount} onMax={() => setAmount(String(Math.max(wallet, canFaucet ? z.faucetAmount : 0)))} label="Wallet" balance={`${fmt(wallet)} USDC`} />
      {error ? <Note kind="error">{error}</Note> : null}
      <Action busy={busy} reason={reason} label={a > 0 ? `Enable trading · deposit ${fmt(a, 0)} USDC` : renew ? 'Turn on 1-click trading' : 'Enable trading'} onClick={go} />
    </Modal>
  );
}

export function FundsModal() {
  const z = useZap();
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ sig: string; text: string } | null>(null);
  const tab = z.ui.fundsTab;

  useEffect(() => {
    setAmount('');
    setError('');
    setDone(null);
  }, [tab]);

  if (!tab || !z.user) return null;
  const dep = tab === 'deposit';
  const wallet = z.walletUsdc ?? 0;
  const trading = Number(store.account?.balance ?? 0) / 1e6;
  const max = dep ? wallet : trading;
  const a = Number(amount) || 0;
  const canFaucet = z.faucetReadyAt != null && z.faucetReadyAt <= Date.now();
  const reason = !a ? 'Enter amount' : a > max + 1e-9 ? (dep ? 'More than your wallet holds' : 'More than your trading balance') : '';
  const go = () => {
    setError('');
    setDone(null);
    setBusy('Approve in your wallet…');
    (dep ? z.ui.depositFunds(a) : z.ui.withdrawFunds(a))
      .then((sig) => {
        setBusy('');
        setAmount('');
        setDone({ sig, text: dep ? `Deposited ${fmt(a)} USDC to your trading balance` : `Withdrew ${fmt(a)} USDC to your wallet` });
      })
      .catch((e: unknown) => {
        setBusy('');
        setError(describeError(e));
      });
  };
  const faucet = () => {
    setError('');
    setBusy('Getting test USDC…');
    z.faucet()
      .then((r) => {
        setBusy('');
        setDone({ sig: r.signature, text: `Received ${fmt(r.amount, 0)} test USDC in your wallet` });
      })
      .catch((e: unknown) => {
        setBusy('');
        setError(describeError(e));
      });
  };

  return (
    <Modal onClose={() => !busy && z.ui.closeFunds()} title="Funds" sub="Move USDC between your wallet and your ZAP trading balance. Withdrawals always go to your wallet.">
      <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:3px;padding:3px;background:var(--in);border-radius:7px')}>
        {(['deposit', 'withdraw'] as const).map((t) => (
          <Fragment key={t}>
            <button
              onClick={() => !busy && z.ui.setFundsTab(t)}
              style={sx(`height:32px;border-radius:5px;border:0;background:${tab === t ? 'var(--h)' : 'transparent'};color:${tab === t ? 'var(--t)' : 'var(--t3)'};box-shadow:${tab === t ? '0 1px 2px rgba(0,0,0,.25)' : 'none'};font:600 13px 'Instrument Sans',sans-serif;cursor:pointer`)}
              className="zp1"
            >
              {t === 'deposit' ? 'Deposit' : 'Withdraw'}
            </button>
          </Fragment>
        ))}
      </div>
      <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:8px')}>
        {[
          ['Wallet', wallet],
          ['Trading balance', trading],
        ].map(([label, v]) => (
          <div key={label as string} style={sx('padding:10px 12px;background:var(--in);border-radius:6px;display:flex;flex-direction:column;gap:4px')}>
            <span style={sx('font-size:11.5px;color:var(--t3)')}>{label}</span>
            <span style={sx("font:500 14px 'Geist',sans-serif;font-variant-numeric:tabular-nums")}>{fmt(v as number)} USDC</span>
          </div>
        ))}
      </div>
      <Amount value={amount} onChange={setAmount} onMax={() => setAmount(String(Math.floor(max * 100) / 100))} label={dep ? 'Wallet' : 'Trading balance'} balance={`${fmt(max)} USDC`} />
      {dep && canFaucet ? (
        <button onClick={faucet} disabled={!!busy} style={sx("align-self:flex-start;background:none;border:0;padding:0;color:var(--a);font:600 12.5px 'Instrument Sans',sans-serif;cursor:pointer")}>
          Get {fmt(z.faucetAmount, 0)} test USDC from the faucet
        </button>
      ) : null}
      {error ? <Note kind="error">{error}</Note> : null}
      {done ? (
        <Note kind="ok">
          {done.text} ·{' '}
          <a href={txUrl(done.sig)} target="_blank" rel="noreferrer" style={sx('color:inherit;text-decoration:underline;text-underline-offset:2px')}>
            View transaction
          </a>
        </Note>
      ) : null}
      <Action busy={busy} reason={reason} label={dep ? 'Deposit USDC' : 'Withdraw USDC'} onClick={go} />
    </Modal>
  );
}
