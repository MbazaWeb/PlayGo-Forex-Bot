import React, { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal, Sparkles } from 'lucide-react';
import StrategyReplay from './Replay';
import { catalog } from '../../../../backend/trading/pack/catalog.js';
import { AUTOMATIC, AUTO_PERIODS } from '../../../../backend/trading/pack/automatic.js';
import { validPeriods } from '../../../../backend/trading/crossover.js';

const rules = catalog.filter((s) => s.available);
const name = (id) =>
  catalog.find((s) => s.id === id)?.name ||
  (id === AUTOMATIC ? 'Automatic selection' : '-');

async function api(path, options) {
  const response = await fetch(path, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error || 'Request failed');
  }
  return response.json();
}

export default function Strategy({ accountId, accountType }) {
  if (accountType !== 'demo' || typeof accountId !== 'string' || !accountId) {
    return (
      <section className="panel bot-setup">
        <h2>Demo account required</h2>
        <p>Trading strategies are available for demo accounts only; real-money strategies are unavailable.</p>
      </section>
    );
  }
  return <DemoStrategy accountId={accountId} />;
}

function DemoStrategy({ accountId }) {
  const base = '/api/demo/strategy?' + new URLSearchParams({ account: accountId });
  const [mode, setMode] = useState(AUTOMATIC);
  const [pack, setPack] = useState('moving-average-crossover');
  const [fast, setFast] = useState(5);
  const [slow, setSlow] = useState(20);
  const [worker, setWorker] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [checking, setChecking] = useState(true);
  const [history, setHistory] = useState(null);
  const [ops, setOps] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const hydrated = useRef(false);

  useEffect(() => {
    const ctrl = new AbortController();
    const opt = { signal: ctrl.signal };
    const tradesRequest = Promise.allSettled([
      api(base + '&view=history', opt),
      api('/api/demo/operations?' + new URLSearchParams({ account: accountId }), opt),
    ]);

    async function load() {
      setChecking(true);
      try {
        const { strategy: row } = await api(base, opt);
        if (ctrl.signal.aborted) return;
        setWorker(row);
        setLoaded(true);
        if (!hydrated.current && row) {
          setMode(row.pack_id === AUTOMATIC ? AUTOMATIC : 'manual');
          setPack(row.pack_id && row.pack_id !== AUTOMATIC ? row.pack_id : 'moving-average-crossover');
          setFast(row.fast ?? 5);
          setSlow(row.slow ?? 20);
        }
        hydrated.current = true;
      } catch {
        if (ctrl.signal.aborted) return;
        setLoaded(false);
      } finally {
        if (!ctrl.signal.aborted) setChecking(false);
      }
      const [trades, operations] = await tradesRequest;
      if (ctrl.signal.aborted) return;
      setHistory(trades.status === 'fulfilled' ? trades.value.strategy : null);
      setOps(operations.status === 'fulfilled' ? operations.value : null);
    }
    load();
    return () => ctrl.abort();
  }, [accountId, base, refresh]);

  const auto = mode === AUTOMATIC;
  const periods = auto ? AUTO_PERIODS : { fast: Number(fast), slow: Number(slow) };
  const valid = validPeriods(periods.fast, periods.slow);

  async function save(enabled) {
    setBusy(true);
    setNotice('');
    const form = enabled
      ? { pack: auto ? AUTOMATIC : pack, ...periods }
      : { pack: worker?.pack_id || '', fast: worker?.fast ?? fast, slow: worker?.slow ?? slow };
    try {
      const body = await api(base + '&' + new URLSearchParams({ ...form, enabled: String(enabled) }), {
        method: 'POST',
        headers: { 'X-PlayGo-Request': '1' },
      });
      setWorker(body.strategy);
      setNotice(enabled ? 'Bot enabled.' : 'Bot paused.');
      setRefresh((n) => n + 1);
    } catch {
      setNotice('Could not confirm the change. Refresh status before retrying.');
    } finally {
      setBusy(false);
    }
  }

  const latest = ops?.intents?.find((x) => x.status === 'confirmed' || x.status === 'settled');

  return (
    <section className="panel bot-setup">
      <div className="panelhead">
        <div>
          <h2>Demo bot setup</h2>
          <p>EUR/USD - 1-minute candles - demo account {accountId}</p>
        </div>
        <span className="bot-state">
          {checking ? 'Checking...' : !loaded ? 'Setup unavailable' : worker?.enabled ? 'Enabled' : worker ? 'Paused' : 'New bot'}
        </span>
      </div>

      <fieldset className="mode-field">
        <legend>Who selects the strategy?</legend>
        <div className="mode-options">
          {[
            [AUTOMATIC, Sparkles, 'System automation'],
            ['manual', SlidersHorizontal, 'Manual setup'],
          ].map(([value, Icon, title]) => (
            <label className={'mode-option ' + (mode === value ? 'chosen' : '')} key={value}>
              <input type="radio" name={'mode-' + accountId} checked={mode === value} onChange={() => setMode(value)} />
              <Icon size={21} />
              <strong>{title}</strong>
            </label>
          ))}
        </div>
      </fieldset>

      {auto ? (
        <p className="mode-detail">
          Directional movement selects RSI Momentum. Choppy movement selects Bollinger Bands Reversion. Flat prices produce no trade signal.
        </p>
      ) : (
        <div className="market-controls">
          <label>
            Strategy
            <select value={pack} onChange={(e) => setPack(e.target.value)}>
              {rules.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label>
            Fast period
            <input type="number" min="2" max="99" value={fast} onChange={(e) => setFast(e.target.value)} />
          </label>
          <label>
            Slow period
            <input type="number" min="3" max="100" value={slow} onChange={(e) => setSlow(e.target.value)} />
          </label>
        </div>
      )}

      {!valid && (
        <p role="alert">Use whole periods from 2 to 100. The slow period must exceed the fast period.</p>
      )}

      <div className="bot-actions">
        <button className="primary" disabled={busy || checking || !loaded || !valid} onClick={() => save(true)}>
          {worker?.enabled ? 'Apply setup' : 'Enable bot'}
        </button>
        <button className="outline" disabled={busy || checking || !loaded || !worker?.enabled} onClick={() => save(false)}>
          Pause bot
        </button>
        <button className="textlink" disabled={busy} onClick={() => setRefresh((n) => n + 1)}>
          Refresh status
        </button>
      </div>

      {notice && <p role="status">{notice}</p>}

      <div className="bot-status">
        <div>
          <small>Last worker signal</small>
          <strong>{worker?.signal || 'Awaiting signal'}</strong>
          <small>{worker?.observed_minute ? new Date(worker.observed_minute * 1000).toLocaleString() : 'No observation recorded'}</small>
        </div>
        <div>
          <small>Last evaluated rule</small>
          <strong>{name(worker?.selected_rule)}</strong>
        </div>
        <div>
          <small>Broker execution</small>
          <strong>{!ops ? 'Unverified' : ops.status?.qualified && !ops.status?.paused ? 'Account armed' : 'Off'}</strong>
          <small>{latest ? 'Latest confirmed activity - ' + new Date(latest.updated_at).toLocaleString() : 'No confirmed order shown'}</small>
        </div>
      </div>

      <details>
        <summary>Historical replay</summary>
        <p>Paper simulation only: 100 units per fill on EUR/USD. Spread and fees are excluded; these are not broker orders.</p>
        {valid && <StrategyReplay strategy={auto ? AUTOMATIC : pack} {...periods} />}
      </details>

      <details>
        <summary>Paper strategy history{worker ? ' - ' + worker.paper_trades + ' trades' : ''}</summary>
        <p>Simulated strategy P&amp;L - {worker?.paper_pnl ?? '-'} USD. This is not broker-account P&amp;L.</p>
        {history?.length ? (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  {['Settled', 'Strategy', 'Side', 'Entry', 'Exit', 'P/L (USD)'].map((x) => (
                    <th key={x}>{x}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((t) => (
                  <tr key={t.bar_end}>
                    <td>{new Date(t.bar_end * 1000).toLocaleString()}</td>
                    <td>{name(t.strategy_id)}</td>
                    <td>{t.direction === 'up' ? 'Buy' : 'Sell'}</td>
                    <td>{t.entry}</td>
                    <td>{t.exit}</td>
                    <td>{t.pnl}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>{history ? 'No settled trades.' : 'History unavailable.'}</p>
        )}
      </details>
    </section>
  );
}