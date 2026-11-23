import ConfirmDialog from './ConfirmDialog';
import { AUTOMATIC_SETUP, automaticEntryBlock } from '../../../shared/agent-analysis.js';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { analyzeCandles } from './agentAnalysis.js';
import { publicRequest, readCandles, readMarkets } from './derivMarkets.js';

const retryMarketReasons = new Set([
  'STALE_MARKET_DATA', 'UNALIGNED_MARKET_DATA', 'DUPLICATE_MARKET_DATA', 'MARKET_DATA_GAP', 'WEAK_SIGNAL', 'ELEVATED_VOLATILITY', 'BREAKOUT_NOT_CONFIRMED',
  'NO_QUALIFYING_SIGNAL', 'INSUFFICIENT', 'INVALID', 'MARKET_DATA_TIMEOUT',
  'MARKET_DATA_DISCONNECTED', 'MARKET_DATA_UNAVAILABLE', 'MARKET_DATA_SEND_FAILED',
]);

const INTERVALS = [
  [60, '1 minute'],
  [300, '5 minutes'],
  [900, '15 minutes'],
  [3600, '1 hour'],
];

function AgentCard({ title, status, children }) {
  return (
    <section className="panel agent-card" data-working={status === 'Analyzing' || undefined}>
      <div className="agent-card-heading">
        <h2>{title}</h2>
        <span className="agent-state">{status}</span>
      </div>
      {children}
    </section>
  );
}

function activityEntry(message) {
  return { id: `${Date.now()}-${Math.random()}`, at: new Date().toISOString(), message };
}

export default function TradeAgent({ account, realExecutionEnabled, marketSymbol, onMarketChange }) {
  const [markets, setMarkets] = useState([]);
  const [catalogState, setCatalogState] = useState('loading');
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const setupKey = account ? 'playgo-agent-setup:' + account.account_id : null;
  const [savedSetup] = useState(() => {
    try { return setupKey && JSON.parse(localStorage.getItem(setupKey)); } catch { return null; }
  });
  const symbol = marketSymbol || 'R_75';
  const [manual, setManual] = useState(savedSetup?.manual === true);
  const [manualInterval, setCandleInterval] = useState(
    INTERVALS.some(([seconds]) => seconds === savedSetup?.interval) ? savedSetup.interval : 60,
  );
  const interval = manual ? manualInterval : AUTOMATIC_SETUP.interval;
  const [refresh, setRefresh] = useState(0);
  const [analysis, setAnalysis] = useState({ status: 'waiting', progress: 0 });
  const [activities, setActivities] = useState([]);
  const [agentRunning, setAgentRunning] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [stopping, setStopping] = useState(false);
  const stopPending = useRef(false);
  const generation = useRef(0);
  const tickPending = useRef(false);
  const [scan, setScan] = useState(null);
  const [nextScanSeconds, setNextScanSeconds] = useState(null);
  const activeMarket = useRef(null);
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentStatuses, setAgentStatuses] = useState([]);
  const [agentFeedback, setAgentFeedback] = useState('');
  const [stopLossPercent, setStopLossPercent] = useState('');
  const [takeProfitPercent, setTakeProfitPercent] = useState('');

  useEffect(() => {
    if (!setupKey) return;
    try { localStorage.setItem(setupKey, JSON.stringify({ manual, interval: manualInterval, symbol })); }
    catch { /* Setup remains available for this session. */ }
  }, [setupKey, manual, manualInterval, symbol]);

  const pendingKey = account ? 'playgo:bot-contracts:' + account.account_id : '';
  const [pendingContracts, setPendingContracts] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(pendingKey) || '[]');
      return Array.isArray(stored) ? stored.filter(id => typeof id === 'string') : [];
    } catch { return []; }
  });
  useEffect(() => {
    if (!pendingKey) return;
    try { localStorage.setItem(pendingKey, JSON.stringify(pendingContracts)); } catch {}
  }, [pendingKey, pendingContracts]);

  const settledKey = pendingKey && pendingKey + ':settled';
  const [settledTrades, setSettledTrades] = useState(() => {
    if (!settledKey) return {};
    try {
      const stored = JSON.parse(localStorage.getItem(settledKey) || '{}');
      return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
    } catch { return {}; }
  });
  useEffect(() => {
    if (!settledKey) return;
    try { localStorage.setItem(settledKey, JSON.stringify(settledTrades)); } catch {}
  }, [settledKey, settledTrades]);

  const trackedAmounts = Object.values(settledTrades).filter(Number.isFinite);
  const winningAmounts = trackedAmounts.filter(value => value > 0);
  const losingAmounts = trackedAmounts.filter(value => value < 0);
  const total = values => values.reduce((sum, value) => sum + value, 0);
  const botMoney = new Intl.NumberFormat('en-US', {
    style: 'currency', currency: account?.currency || 'USD', signDisplay: 'exceptZero',
  });

  const trackContract = useCallback(id => {
    if (id) setPendingContracts(previous => previous.includes(String(id)) ? previous : [...previous, String(id)]);
  }, []);

  const recordActivity = useCallback((message) => {
    setActivities((previous) => [activityEntry(message), ...previous].slice(0, 8));
  }, []);

  useEffect(() => {
    if (!account?.account_id || !pendingContracts.length) return;
    const id = account.account_id;
    const controller = new AbortController();
    let timer;
    async function checkSettlements() {
      try {
        const response = await fetch('/api/history?account=' + encodeURIComponent(id), { signal: controller.signal });
        if (!response.ok) return;
        const body = await response.json();
        if (controller.signal.aborted || body.accountId !== id || !Array.isArray(body.transactions)) return;
        const settled = new Map();
        for (const row of body.transactions) {
          const contractId = row.contractId;
          if (!pendingContracts.includes(contractId) || settled.has(contractId) ||
              !Number.isFinite(row.sell) || !Number.isFinite(row.buy)) continue;
          const pnl = row.sell - row.buy;
          const amount = new Intl.NumberFormat('en-US', {
            style: 'currency', currency: account.currency || 'USD', signDisplay: 'exceptZero',
          }).format(pnl);
          const outcome = pnl > 0 ? 'Win' : pnl < 0 ? 'Loss' : 'Break-even';
          recordActivity(`Closed #${contractId} · ${outcome} ${amount}`);
          settled.set(contractId, Number(pnl.toFixed(8)));
        }
        if (settled.size) {
          setSettledTrades(previous => ({ ...previous, ...Object.fromEntries(settled) }));
          setPendingContracts(previous => previous.filter(contractId => !settled.has(contractId)));
          window.dispatchEvent(new CustomEvent('playgo:settlement', { detail: id }));
        }
      } catch {
        // An unavailable history response leaves contracts pending.
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(checkSettlements, 15_000);
      }
    }
    void checkSettlements();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [account?.account_id, account?.currency, pendingContracts, recordActivity]);

  useEffect(() => {
    const controller = new AbortController();
    setCatalogState('loading');
    publicRequest({ active_symbols: 'full' }, controller.signal)
      .then(readMarkets)
      .then((rows) => {
        if (controller.signal.aborted) return;
        if (!rows.length) throw new Error('No markets returned.');
        setMarkets(rows);
        setCatalogState('ready');
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setCatalogState('error');
        recordActivity('Market list is unavailable.');
      });
    return () => controller.abort();
  }, [catalogAttempt, recordActivity]);

  const selectedMarket = useMemo(
    () => markets.find((market) => market.symbol === symbol) || null,
    [markets, symbol],
  );

  useEffect(() => {
    if (!selectedMarket) return undefined;
    const controller = new AbortController();
    setAnalysis({ status: 'loading', progress: 15 });

    publicRequest({
      ticks_history: selectedMarket.symbol,
      style: 'candles',
      end: 'latest',
      adjust_start_time: 1,
      count: 200,
      granularity: interval,
    }, controller.signal)
      .then(readCandles)
      .then((candles) => {
        if (controller.signal.aborted) return;
        const result = analyzeCandles(candles, interval);
        setAnalysis({ ...result, progress: 100, symbol: selectedMarket.symbol, interval });
        recordActivity(result.status === 'ready'
          ? `${result.direction ? `${result.direction} setup` : 'No qualifying setup'}; confluence ${result.confluenceScore}/100.`
          : result.reason);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setAnalysis({ status: 'error', progress: 100, symbol: selectedMarket.symbol, interval });
        recordActivity(`Analysis failed for ${selectedMarket.symbol}; market data was unavailable.`);
      });

    return () => controller.abort();
  }, [selectedMarket, interval, refresh, recordActivity]);

  const validAccounts = useMemo(() => account ? [account] : [], [account]);
  const accountId = account?.account_id;
  const accountLabel = account?.account_type === 'real' ? 'Real' : 'Demo';
  const executionAvailable = Boolean(accountId) && (accountLabel === 'Demo' || realExecutionEnabled);
  const accountSummary = accountId
    ? `${accountLabel} account ${accountId} selected.`
    : 'Select a Deriv account to trade.';
  const ready = analysis.status === 'ready' && analysis.symbol === selectedMarket?.symbol && analysis.interval === interval;
  const analyzing = analysis.status === 'loading' || catalogState === 'loading';
  const stopLossValue = Number(manual ? stopLossPercent : AUTOMATIC_SETUP.stopLossPercent);
  const takeProfitValue = Number(manual ? takeProfitPercent : AUTOMATIC_SETUP.takeProfitPercent);
  const exitSettingsValid = Number.isFinite(stopLossValue) && stopLossValue > 0 && stopLossValue <= 100 &&
    Number.isFinite(takeProfitValue) && takeProfitValue > 0 && takeProfitValue <= 10000;
  const emergencyRetry = agentStatuses.some(item => item.control?.stop_reason === 'DRAWDOWN_LIMIT');
  const monitoringActive = agentRunning && (exitSettingsValid || emergencyRetry);
  const entryBlock = !manual && ready ? automaticEntryBlock(analysis) : null;
  const signalQualifies = ready && Boolean(analysis.direction) && !entryBlock;
  const recommendation = entryBlock === 'ELEVATED_VOLATILITY'
    ? 'Risk Agent is waiting for volatility to ease.'
    : entryBlock === 'WEAK_SIGNAL'
      ? 'Strategies Agent is waiting for a stronger signal.'
      : ready
    ? analysis.direction
      ? `${analysis.direction === 'bullish' ? 'Bullish' : 'Bearish'} setup to review`
      : 'No setup meets the 75/100 threshold'
    : analysis.status === 'error'
      ? 'Waiting for live market data'
      : analysis.status === 'insufficient'
        ? 'More candles needed'
        : 'Analysis not ready';

  const postAgentAction = useCallback(async (path, params = {}) => {
    const query = new URLSearchParams({ ...params, account: accountId, mode: manual ? 'manual' : 'automatic' });
    const response = await fetch(`/api/agent/${path}${query.size ? `?${query}` : ''}`, {
      method: 'POST',
      headers: { 'X-PlayGo-Request': '1' },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error || 'Agent request failed.');
    return body;
  }, [accountId, manual]);

  useEffect(() => {
    if (!accountId) {
      setAgentStatuses([]);
      setAgentRunning(false);
      return undefined;
    }
    const controller = new AbortController();
    fetch(`/api/agent/status?account=${encodeURIComponent(accountId)}`, { signal: controller.signal })
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body?.error || 'Agent status unavailable.');
        return body;
      })
      .then(body => {
        if (controller.signal.aborted) return;
        const statuses = Array.isArray(body.accounts) ? body.accounts : [];
        setAgentStatuses(statuses);
        setAgentRunning(statuses.some(item =>
          item.control?.active === true || item.control?.stop_reason === 'DRAWDOWN_LIMIT',
        ));
        const controls = statuses.map(item => item.control);
        const configured = controls.map(control => ({
          stopLoss: Number(control?.stop_loss_percent),
          takeProfit: Number(control?.take_profit_percent),
        }));
        const first = configured[0];
        const allMatch = statuses.length === 1 &&
          configured.every(settings =>
            Number.isFinite(settings.stopLoss) && settings.stopLoss > 0 && settings.stopLoss <= 100 &&
            Number.isFinite(settings.takeProfit) && settings.takeProfit > 0 && settings.takeProfit <= 10000 &&
            settings.stopLoss === first?.stopLoss && settings.takeProfit === first?.takeProfit,
          );
        if (allMatch) {
          setStopLossPercent(String(first.stopLoss));
          setTakeProfitPercent(String(first.takeProfit));
        } else {
          setStopLossPercent('');
          setTakeProfitPercent('');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setAgentFeedback('Emergency Agent status unavailable.');
      });
    return () => controller.abort();
  }, [accountId]);

  const runAgent = useCallback(async (exitsOnly = false) => {
    if (!executionAvailable || !selectedMarket ||
        (!exitSettingsValid && !emergencyRetry) || agentBusy || stopPending.current || tickPending.current) return;
    tickPending.current = true;
    const requestGeneration = generation.current;
    setAgentBusy(true);
    try {
      const scanning = !manual && !exitsOnly;
      let candidates = [selectedMarket];
      if (scanning) {
        setScan({ checked: 0, total: 0, running: true, current: 'Refreshing open markets', rows: [] });
        const currentMarkets = readMarkets(await publicRequest({ active_symbols: 'full' }));
        if (requestGeneration !== generation.current || stopPending.current) return;
        const open = currentMarkets.filter(market => market.status === 'Open');
        const preferred = [activeMarket.current, selectedMarket.symbol];
        candidates = [...open.filter(market => preferred.includes(market.symbol))
          .sort((a, b) => preferred.indexOf(a.symbol) - preferred.indexOf(b.symbol)),
          ...open.filter(market => !preferred.includes(market.symbol))].slice(0, 5);
        if (!candidates.length) {
          setScan({ checked: 0, total: 0, running: false, rows: [] });
          setAgentFeedback('No open markets are available for an entry check.');
          return;
        }
      }
      const trace = [];
      let results = [];
      for (const market of candidates) {
        if (requestGeneration !== generation.current || stopPending.current) return;
        if (scanning) setScan({ checked: trace.length, total: candidates.length, running: true, current: market.name, rows: [...trace] });
        const body = await postAgentAction('run', {
          symbol: market.symbol,
          granularity: String(interval),
          ...(exitsOnly && { exitsOnly: '1' }),
          ...(scanning && { marketScan: '1' }),
        });
        results = Array.isArray(body.accounts) ? body.accounts : [];
        if (scanning) {
          const outcome = results[0];
          trace.push({ symbol: market.symbol, name: market.name, ...outcome });
          if (outcome?.status === 'ordered') activeMarket.current = market.symbol;
          if (requestGeneration !== generation.current) {
            if (outcome?.status === 'ordered') {
              trackContract(outcome.contractId);
              recordActivity(`Open #${outcome.contractId} · Deriv confirmed the in-flight order for ${market.symbol}.`);
            }
            return;
          }
          setScan({ checked: trace.length, total: candidates.length, running: false, rows: [...trace] });
          const canContinue = results.length === 1 && (retryMarketReasons.has(outcome.reason) ||
            /^DERIV_PROPOSAL_REJECTED(?:_|$)/.test(outcome.reason || ''));
          if (canContinue) continue;
        }
        break;
      }
      if (results.some(item => item.closeResults?.some(contract => contract.closed))) {
        window.dispatchEvent(new CustomEvent('playgo:settlement', { detail: accountId }));
      }
      if (requestGeneration !== generation.current) return;
      const activeResults = results.some(item =>
        ['watching', 'ordered', 'exited', 'error'].includes(item.status) ||
        (item.status === 'stopped' && item.reason === 'DRAWDOWN_LIMIT' && item.closeResults?.length > 0),
      );
      setAgentRunning(activeResults);
      setAgentStatuses(results.map(item => ({
        accountId: item.accountId,
        control: item.status === 'stopped' ? { active: false, paused: true, stop_reason: item.reason } : undefined,
        result: item,
      })));
      for (const result of results) {
        if (result.status === 'ordered') {
          trackContract(result.contractId);
          recordActivity(`Open #${result.contractId} · Deriv ${accountLabel} order confirmed for ${result.symbol}; stake ${result.stake} (${result.score}/100 confluence).`);
        } else if (result.status === 'exited') {
          const exits = result.closeResults || [];
          const confirmed = exits.filter(contract => contract.closed).length;
          recordActivity(`Exit trigger reached. Deriv confirmed ${confirmed} of ${exits.length} closes.`);
        } else if (result.status === 'stopped') {
          recordActivity(`Emergency Agent stopped trading: ${result.reason}. Close requests were attempted where applicable.`);
        } else if (result.status === 'error') {
          recordActivity(`Agent could not complete its run: ${result.reason}.`);
        }
      }
      if (exitsOnly && results.every(item => item.reason === 'EXIT_MONITORING')) return;
      const outcome = results[0];
      const reason = outcome?.reason?.replaceAll('_', ' ');
      setAgentFeedback(outcome?.status === 'ordered'
        ? `Order opened on ${outcome.symbol}.`
        : outcome?.status === 'watching' || outcome?.status === 'error'
          ? `No order placed. ${reason || 'No qualifying setup.'}`
          : reason || (outcome ? 'Position check complete.' : 'No account result was returned.'));
    } catch (error) {
      if (requestGeneration !== generation.current) return;
      setAgentFeedback(error.message || 'Agent run failed.');
      recordActivity('Agent run failed; no success was assumed.');
    } finally {
      tickPending.current = false;
      setScan(previous => previous?.running ? { ...previous, running: false } : previous);
      setAgentBusy(false);
    }
  }, [accountId, accountLabel, agentBusy, emergencyRetry, executionAvailable, exitSettingsValid, interval, postAgentAction, recordActivity, selectedMarket, stopLossValue, takeProfitValue, validAccounts, trackContract, manual]);

  const latestRun = useRef(runAgent);
  const latestBusy = useRef(agentBusy);
  useEffect(() => { latestRun.current = runAgent; latestBusy.current = agentBusy; }, [runAgent, agentBusy]);
  const schedulerReady = Boolean(executionAvailable && selectedMarket);
  useEffect(() => {
    if (!agentRunning || !schedulerReady || (!exitSettingsValid && !emergencyRetry)) {
      setNextScanSeconds(null);
      return;
    }
    let entryDue = Date.now();
    let exitDue = Date.now() + 15_000;
    const timer = setInterval(() => {
      const time = Date.now();
      setNextScanSeconds(emergencyRetry ? null : Math.max(0, Math.ceil((entryDue - time) / 1000)));
      if (stopPending.current || tickPending.current || latestBusy.current) return;
      if (!emergencyRetry && time >= entryDue) {
        entryDue = time + interval * 1000;
        exitDue = time + 15_000;
        void latestRun.current();
      } else if (time >= exitDue) {
        exitDue = time + 15_000;
        void latestRun.current(true);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [agentRunning, emergencyRetry, exitSettingsValid, interval, schedulerReady]);

  async function startAgent() {
    if (agentBusy || !executionAvailable || !exitSettingsValid) return;
    setAgentBusy(true);
    setAgentFeedback('');
    try {
      const body = await postAgentAction('start', {
        stopLossPercent: String(stopLossValue),
        takeProfitPercent: String(takeProfitValue),
      });
      const statuses = Array.isArray(body.accounts) ? body.accounts : [];
      setAgentStatuses(statuses);
      const active = statuses.some(item => item.active === true);
      setAgentRunning(active);
      setAgentFeedback(active ? 'Bot Agents started.' : statuses[0]?.error || 'The selected account could not be started.');
      recordActivity(active
        ? `Bot Agents started on ${accountLabel} account ${accountId}.`
        : 'Bot Agents did not start; check account and database configuration.');
    } catch (error) {
      setAgentFeedback(error.message || 'Could not start Bot Agents.');
    } finally {
      setAgentBusy(false);
    }
  }

  async function placeTradeNow() {
    if (agentBusy || !executionAvailable || !selectedMarket || !ready ||
        !signalQualifies || !exitSettingsValid) return;
    setAgentBusy(true);
    setAgentFeedback('');
    try {
      const body = await postAgentAction('place', {
        symbol: selectedMarket.symbol,
        granularity: String(interval),
        stopLossPercent: String(stopLossValue),
        takeProfitPercent: String(takeProfitValue),
      });
      const results = Array.isArray(body.accounts) ? body.accounts : [];
      const active = results.some(item =>
        item.automationActive === true ||
        item.automationActive === null ||
        (item.status === 'stopped' && item.reason === 'DRAWDOWN_LIMIT' && item.closeResults?.length > 0),
      );
      setAgentRunning(active);
      setAgentStatuses(results.map(item => ({
        accountId: item.accountId,
        control: item.status === 'stopped' ? { active: false, paused: true, stop_reason: item.reason } : undefined,
        result: item,
      })));
      for (const result of results) {
        if (result.status === 'ordered') {
          trackContract(result.contractId);
          recordActivity(`Open #${result.contractId} · Deriv ${accountLabel} order confirmed for ${result.symbol}; stake ${result.stake} (${result.score}/100 confluence). Bot Agents remain active for monitoring and scheduled checks.`);
        } else if (result.status === 'exited') {
          const exits = result.closeResults || [];
          const confirmed = exits.filter(contract => contract.closed).length;
          recordActivity(`Exit trigger reached. Deriv confirmed ${confirmed} of ${exits.length} closes.`);
        } else {
          recordActivity(`One-time trade not placed: ${result.reason || result.status}.`);
        }
      }
      setAgentFeedback(results.length
        ? `Trade check completed for ${accountLabel} account ${accountId}. Bot Agents remain active after a successful order.`
        : 'No account result was returned.');
    } catch (error) {
      setAgentFeedback(error.message || 'Could not place the one-time trade.');
      recordActivity('One-time trade request failed; no success was assumed.');
    } finally {
      setAgentBusy(false);
    }
  }

  async function stopAgent() {
    if (!accountId || stopPending.current) return;
    stopPending.current = true;
    generation.current++;
    setStopping(true);
    try {
      const body = await postAgentAction('stop');
      const state = body.accounts?.find(item => item.accountId === accountId);
      if (!state || state.error || state.active !== false)
        throw Error(state?.error || 'Deriv account stop was not confirmed.');
      setAgentStatuses(body.accounts);
      setAgentRunning(false);
      setAgentFeedback('Bot stopped. Open contracts remain in Overview.');
      recordActivity('Bot Agents stopped.');
    } catch (error) {
      setAgentFeedback(error.message || 'Could not stop Bot Agents.');
    } finally {
      stopPending.current = false;
      setStopping(false);
    }
  }

  return (
    <div className="trade-agent-dashboard">
      <section className="panel agent-command" aria-label="Bot controls">
        <div><h2>Bot control</h2><p role="status">
          {stopping ? 'Stopping bot...' : monitoringActive ? 'Running' : agentRunning ? 'Paused' : 'Standby'}
        </p></div>
        <button type="button" className="outline agent-stop" disabled={!agentRunning || stopping}
          onClick={stopAgent}><span aria-hidden="true" className="stop-mark" /> Stop Bot</button>
        {agentRunning && nextScanSeconds !== null && <p className="agent-command-feedback">
          {scan?.running ? 'Scanning open markets...' : nextScanSeconds === 0
            ? 'Scan due; waiting for the current check.'
            : `Next entry scan in ${Math.floor(nextScanSeconds / 60)}:${String(nextScanSeconds % 60).padStart(2, '0')}`}
        </p>}
        {agentFeedback && <p className="agent-command-feedback" role="status">{agentFeedback}</p>}
        {pendingContracts.length > 0 && <p className="agent-command-feedback">{pendingContracts.length} bot contract(s) awaiting settlement</p>}
        {activities[0] && <p className="agent-command-feedback" role="status">{activities[0].message}</p>}
      </section>
      <section aria-label="Bot results">
        <div className="panelhead"><div><h2>Bot results</h2><p>Tracked on this browser</p></div></div>
        <div className="metrics bot-results">
          <div className="metric"><small>{winningAmounts.length} wins</small><strong className="gain">{botMoney.format(total(winningAmounts))}</strong></div>
          <div className="metric"><small>{losingAmounts.length} losses</small><strong className="loss">{botMoney.format(total(losingAmounts))}</strong></div>
          <div className="metric"><small>{trackedAmounts.length} settled · Net</small><strong>{botMoney.format(total(trackedAmounts))}</strong></div>
        </div>
      </section>
      <section className="panel agent-flow" aria-label="Agent workflow">
        <div className="panelhead"><div><h2>Agent workflow</h2></div></div>
        <ol className="agent-flow-steps">
          <li><strong>Market Scout</strong><small>{scan?.running ? scan.current : scan ? `${scan.checked} market(s) checked` : 'Waiting for next scan'}</small></li>
          <li><strong>Strategy</strong><small>{scan?.rows.at(-1)?.strategy || 'Trend + momentum / breakout'}</small></li>
          <li><strong>Risk</strong><small>{monitoringActive ? 'Monitoring' : 'Standby'}</small></li>
          <li><strong>Execution</strong><small>{scan?.rows.at(-1)?.status === 'ordered' ? 'Order confirmed' : 'Waiting for eligible signal'}</small></li>
        </ol>
        {scan && <div className="agent-scan">
          <div className="agent-progress-heading">
            <strong>{scan.running ? 'Checking with Deriv' : 'Scan finished'}</strong>
            <span>{scan.total ? Math.round(scan.checked / scan.total * 100) : 0}% · {scan.checked}/{scan.total}</span>
          </div>
          <progress aria-label="Markets checked" max={scan.total || 1} value={scan.checked} />
          {scan.rows.length > 0 && <ul>{scan.rows.map(row => <li key={row.symbol}>
            <strong>{row.name}</strong><span>{row.status === 'ordered' ? 'Order confirmed' : (row.reason || row.status || 'No response').replaceAll('_', ' ')}</span>
            {Number.isFinite(row.score) && <small>{row.score}/100 signal score</small>}
          </li>)}</ul>}
        </div>}
      </section>
      <section className="panel agent-controls">
        <div className="panelhead">
          <div>
            <h2>Trading setup</h2>
            <p>{accountSummary}</p>
          </div>
          <button
            className="outline"
            disabled={analyzing || catalogState === 'error'}
            onClick={() => setRefresh((value) => value + 1)}
          >
            {analyzing ? 'Analyzing...' : 'Analyze again'}
          </button>
        </div>
        <div className="agent-mode-bar">
          <div className="agent-mode-options" role="group" aria-label="Trading setup mode">
            <button type="button" className={manual ? 'outline' : 'primary'} aria-pressed={!manual}
              disabled={agentBusy || agentRunning} onClick={() => setManual(false)}>Automatic</button>
            <button type="button" className={manual ? 'primary' : 'outline'} aria-pressed={manual}
              disabled={agentBusy || agentRunning} onClick={() => {
                setStopLossPercent(value => value || String(AUTOMATIC_SETUP.stopLossPercent));
                setTakeProfitPercent(value => value || String(AUTOMATIC_SETUP.takeProfitPercent));
                setManual(true);
              }}>Manual Setup</button>
          </div>
          {agentRunning && <small>Stop trading to change your setup.</small>}
        </div>
        {!manual && (
          <dl className="agent-setup-summary">
            <div><dt>Market</dt><dd>{selectedMarket?.name || 'Loading'}</dd></div>
            <div><dt>Check interval</dt><dd>5 minutes</dd></div>
            <div><dt>Stop-loss target</dt><dd>{stopLossValue}% of stake</dd></div>
            <div><dt>Take-profit target</dt><dd>{takeProfitValue}% of stake</dd></div>
          </dl>
        )}
        {catalogState === 'error' ? (
          <p role="alert">
            Market list unavailable.{' '}
            <button className="textlink" onClick={() => setCatalogAttempt((value) => value + 1)}>Retry</button>
          </p>
        ) : manual && (
          <div className="agent-control-row">
            <label>
              Market
              <select
                value={selectedMarket?.symbol || ''}
                disabled={!markets.length || analyzing || agentRunning || agentBusy}
                onChange={(event) => onMarketChange(event.target.value)}
              >
                {markets.map((market) => (
                  <option key={market.symbol} value={market.symbol}>{market.name} ({market.symbol})</option>
                ))}
              </select>
            </label>
            <label>
              Candle interval and schedule
              <select
                value={interval}
                disabled={analyzing || agentRunning || agentBusy}
                onChange={(event) => setCandleInterval(Number(event.target.value))}
              >
                {INTERVALS.map(([seconds, title]) => (
                  <option key={seconds} value={seconds}>{title}</option>
                ))}
              </select>
            </label>
          </div>
        )}
        {manual && <div className="agent-control-row">
          <label>
            Stop loss (% of stake)
            <input
              type="number"
              min="0.01"
              max="100"
              step="0.1"
              value={stopLossPercent}
              disabled={agentBusy || monitoringActive}
              onChange={(event) => setStopLossPercent(event.target.value)}
              aria-label="Stop loss percentage of stake"
            />
          </label>
          <label>
            Take profit (% of stake)
            <input
              type="number"
              min="0.01"
              max="10000"
              step="0.1"
              value={takeProfitPercent}
              disabled={agentBusy || monitoringActive}
              onChange={(event) => setTakeProfitPercent(event.target.value)}
              aria-label="Take profit percentage of stake"
            />
          </label>
        </div>}
        {accountId && !executionAvailable && <p role="status">Real-money execution is disabled on the server.</p>}
        {!exitSettingsValid && <p role="status">Enter valid stop-loss and take-profit percentages to enable trading.</p>}
      </section>

      <section className="panel agent-progress" aria-live="polite">
        <div className="agent-progress-heading">
          <h2>Analysis progress</h2>
          <strong>{analysis.progress || 0}%</strong>
        </div>
        <progress max="100" value={analysis.progress || 0} aria-label="Market analysis progress" />
      </section>

      <div className="agent-card-grid">
        <AgentCard title="Risk Agent" status={ready ? 'Updated' : analyzing ? 'Analyzing' : 'Waiting'}>
          {ready
            ? <p>{analysis.riskLevel} volatility · {analysis.volatilityPct.toFixed(4)}%</p>
            : <p>Waiting for candles.</p>}
        </AgentCard>
        <AgentCard title="Strategies Agent" status={ready ? 'Updated' : analyzing ? 'Analyzing' : 'Waiting'}>
          {ready
            ? <p>SMA 20 {analysis.sma20.toFixed(5)} · SMA 50 {analysis.sma50.toFixed(5)} · RSI {analysis.rsi.toFixed(1)} · momentum {analysis.momentumPct.toFixed(3)}%.</p>
            : <p>Waiting for signal.</p>}
        </AgentCard>
        <AgentCard title="Reminder Agent" status={ready ? 'Ready' : 'Waiting'}>
          {ready
            ? <p>Next check {new Date(analysis.reviewAt * 1000).toLocaleTimeString('en-GB', { timeZone: 'Africa/Dar_es_Salaam' })} EAT</p>
            : <p>Waiting for next check.</p>}
        </AgentCard>
        <AgentCard title="Finance and Account Agents" status={validAccounts?.length ? 'Checked' : 'Unavailable'}>
          {validAccounts?.map((account, index) => {
            const latest = agentStatuses.find(item => item.accountId === account.account_id);
            const equity = latest?.result?.equity ?? latest?.equity;
            const balance = Number(account.balance);
            const nextStake = Number.isFinite(balance) && balance > 0
              ? Math.floor(balance * 0.01 * 1e8) / 1e8
              : null;
            return (
              <p key={account.account_id}>
                Account {index + 1} ({account.currency || 'currency'}) next stake:{' '}
                {Number.isFinite(nextStake) ? `${nextStake.toFixed(2)} ${account.currency || ''}` : 'unavailable'} · equity at last verified check:{' '}
                {Number.isFinite(equity) ? `${equity.toFixed(2)} ${account.currency || ''}` : 'awaiting verified trade check'}
              </p>
            );
          })}
        </AgentCard>
        <AgentCard title="Emergency Agent" status={monitoringActive ? 'Monitoring' : agentRunning ? 'Settings required' : 'Standby'}>
        </AgentCard>
        <AgentCard title="Bot Agents" status={monitoringActive ? 'Running' : agentRunning ? 'Settings required' : ready ? 'Ready' : analyzing ? 'Analyzing' : 'Waiting'}>
          <p className="agent-recommendation">{recommendation}</p>
          {ready && <p>Confluence score: {analysis.confluenceScore}/100 · {analysis.bars} bars checked.</p>}
          <button
            type="button"
            className="primary agent-proposal-button"
            disabled={agentBusy || !executionAvailable || !signalQualifies || !exitSettingsValid}
            onClick={() => setConfirmation('place')}
          >
            {agentBusy ? 'Checking...' : 'Place Trade Now'}
          </button>
          {!agentRunning && <button type="button" className="outline agent-proposal-button" disabled={agentBusy || !executionAvailable || !selectedMarket || !exitSettingsValid} onClick={() => setConfirmation('start')}>Start scheduled trading</button>}
          {agentRunning && <button type="button" className="outline" disabled={agentBusy || !selectedMarket} onClick={() => void runAgent()}>{agentBusy ? 'Checking...' : 'Run check now'}</button>}
        </AgentCard>
      </div>

      <section className="panel agent-activity">
        <div className="panelhead"><div><h2>Agent activity</h2></div></div>
        {activities.length ? (
          <ol>
            {activities.map((item) => (
              <li key={item.id}>
                <time dateTime={item.at}>{new Date(item.at).toLocaleTimeString()}</time>
                <span>{item.message}</span>
              </li>
            ))}
          </ol>
        ) : <p>No agent activity yet.</p>}
      </section>
      {confirmation && <ConfirmDialog
        title={confirmation === 'start' ? 'Start Bot Agents' : 'Review bot trade'}
        confirmLabel={confirmation === 'start' ? 'Start trading' : 'Check and trade'}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => {
          setConfirmation(null);
          void (confirmation === 'start' ? startAgent() : placeTradeNow());
        }}>
        <p>{selectedMarket?.name || 'Selected market'} on Deriv {accountLabel} account {accountId}.</p>
        <p>1% stake per order. Keep Bot Agents open for scheduled checks.</p>
      </ConfirmDialog>}
    </div>
  );
}
