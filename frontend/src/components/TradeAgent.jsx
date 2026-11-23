import { brokerCoolingDown, brokerRequest, pauseBrokerRequests, simpleBotStatus } from './brokerRequest';
import AccountActivity from './AccountActivity';
import ConfirmDialog from './ConfirmDialog';
import { AUTOMATIC_SETUP } from '../../../shared/agent-analysis.js';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { closedMarketBars, reviewMarket } from '../../../shared/market-review.js';
import { publicRequest, readMarkets } from './derivMarkets.js';

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
  const checkInterval = manual ? manualInterval : AUTOMATIC_SETUP.checkInterval;
  const useUsdTargets = account?.currency === 'USD';
  const cappedAutomaticStake = !manual && useUsdTargets;
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
  const fallbackOffset = useRef(0);
  const [completedScans, setCompletedScans] = useState(0);
  const [lastScanAt, setLastScanAt] = useState(null);
  useEffect(() => () => { generation.current++; }, []);
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
    if (id) window.dispatchEvent(new CustomEvent('playgo:position', { detail: account?.account_id }));
    if (id) setPendingContracts(previous => previous.includes(String(id)) ? previous : [...previous, String(id)]);
  }, [account?.account_id]);

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
        const response = await brokerRequest('/api/history?account=' + encodeURIComponent(id), { signal: controller.signal });
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
    let timer;
    async function update() {
      setAnalysis({ status: 'loading' });
      try {
        const response = await publicRequest({
          ticks_history: selectedMarket.symbol, style: 'candles', end: 'latest',
          count: 200, granularity: interval,
        }, controller.signal);
        if (controller.signal.aborted) return;
        const now = Date.now();
        const candles = closedMarketBars(response.candles, interval, now);
        const result = reviewMarket(candles, interval, now, !manual);
        setAnalysis({ ...result, progress: 100, symbol: selectedMarket.symbol, interval });
        recordActivity(result.block ? simpleBotStatus(result.block)
          : (result.direction || 'Neutral') + ' setup, signal score ' + result.confluenceScore + '/100.');
      } catch {
        if (controller.signal.aborted) return;
        setAnalysis({ status: 'error', symbol: selectedMarket.symbol, interval });
        recordActivity('Price history unavailable for ' + selectedMarket.symbol + '.');
      } finally {
        if (!controller.signal.aborted) {
          const period = interval * 1000;
          timer = setTimeout(update, period - Date.now() % period + 1500);
        }
      }
    }
    void update();
    return () => { clearTimeout(timer); controller.abort(); };
  }, [selectedMarket, interval, manual, refresh, recordActivity]);

  const validAccounts = useMemo(() => account ? [account] : [], [account]);
  const accountId = account?.account_id;
  const [controlLoaded, setControlLoaded] = useState(false);
  const [manuallyStopped, setManuallyStopped] = useState(() => {
    try { return localStorage.getItem('playgo-agent-stop:' + accountId) === '1'; }
    catch { return false; }
  });
  const autoStartDemo = account?.account_type === 'demo' && !manual;
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
  const entryBlock = analysis.block;
  const signalQualifies = ready && Boolean(analysis.direction) && !entryBlock;
  const recommendation = entryBlock === 'ELEVATED_VOLATILITY'
    ? 'Risk Agent is waiting for volatility to ease.'
    : entryBlock === 'WEAK_SIGNAL'
      ? 'Strategies Agent is waiting for a stronger signal.'
      : entryBlock ? simpleBotStatus(entryBlock)
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
    const response = await brokerRequest(`/api/agent/${path}${query.size ? `?${query}` : ''}`, {
      method: 'POST',
      headers: { 'X-PlayGo-Request': '1' },
      signal: AbortSignal.timeout(30_000),
    }).catch(error => {
      throw new Error(error.name === 'TimeoutError'
        ? 'PlayGo request timed out. Checking again on the next scheduled run.'
        : 'Could not reach PlayGo. Check your connection.');
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const reason = typeof body?.error === 'string' ? body.error : 'Agent request failed';
      throw new Error(`${reason} (HTTP ${response.status})`);
    }
    if (!body || (path === 'run' && !Array.isArray(body.accounts))) {
      throw new Error('PlayGo returned an invalid agent response.');
    }
    if (Array.isArray(body.accounts) && body.accounts.some(item => /RATE_LIMIT/.test(item.reason || item.error || ''))) {
      pauseBrokerRequests();
    }
    return body;
  }, [accountId, manual]);

  useEffect(() => {
    if (!accountId) {
      setAgentStatuses([]);
      setAgentRunning(false);
      return undefined;
    }
    const controller = new AbortController();
    let retry;
    function loadControl() {
      brokerRequest(`/api/agent/status?account=${encodeURIComponent(accountId)}`, {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
      })
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body?.error || 'Agent status unavailable.');
        return body;
      })
      .then(body => {
        if (controller.signal.aborted) return;
        const statuses = Array.isArray(body.accounts) ? body.accounts : [];
        const status = statuses.find(item => item.accountId === accountId);
        if (!status || status.error) throw Error(status?.error || 'Account status unavailable.');
        setControlLoaded(true);
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
        if (controller.signal.aborted) return;
        setAgentFeedback('Bot status unavailable. Retrying automatically.');
        retry = setTimeout(loadControl, 15000);
      });
    }
    loadControl();
    return () => {
      clearTimeout(retry);
      controller.abort();
    };
  }, [accountId]);

  const runAgent = useCallback(async (exitsOnly = false) => {
    if (!executionAvailable || !selectedMarket ||
        (!exitSettingsValid && !emergencyRetry) || agentBusy || stopPending.current || tickPending.current) return;
    tickPending.current = true;
    const requestGeneration = generation.current;
    setAgentBusy(true);
    let stage = 'Position check';
    try {
      const scanning = !manual && !exitsOnly;
      let candidates = [selectedMarket];
      if (scanning) {
        stage = 'Deriv market list';
        setScan({ checked: 0, total: 0, running: true, current: 'Refreshing open markets', rows: [] });
        const currentMarkets = readMarkets(await publicRequest({ active_symbols: 'full' }, AbortSignal.timeout(15_000)));
        if (requestGeneration !== generation.current || stopPending.current) return;
        const open = currentMarkets.filter(market => market.status === 'Open');
        const preferred = [activeMarket.current, selectedMarket.symbol];
        const primary = open.filter(market => preferred.includes(market.symbol))
          .sort((a, b) => preferred.indexOf(a.symbol) - preferred.indexOf(b.symbol));
        const backups = open.filter(market => !preferred.includes(market.symbol));
        const offset = fallbackOffset.current % Math.max(backups.length, 1);
        candidates = [...primary, ...backups.slice(offset), ...backups.slice(0, offset)].slice(0, AUTOMATIC_SETUP.marketsPerScan);
        fallbackOffset.current += Math.max(1, AUTOMATIC_SETUP.marketsPerScan - primary.length);
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
        stage = exitsOnly ? 'Exit monitoring' : `Entry check for ${market.name || market.symbol}`;
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
          if (outcome?.status === 'ordered') {
            trackContract(outcome.contractId);
            recordActivity(`Open #${outcome.contractId} · Deriv confirmed an order for ${market.name || market.symbol}.`);
          }
          setScan({ checked: trace.length, total: candidates.length, running: true, rows: [...trace] });
          const canContinue = results.length === 1 && (outcome.status === 'ordered' ||
            outcome.reason === 'MARKET_ALREADY_OPEN' || retryMarketReasons.has(outcome.reason) ||
            /^DERIV_PROPOSAL_REJECTED(?:_|$)/.test(outcome.reason || ''));
          if (canContinue) continue;
        }
        break;
      }
      if (scanning && requestGeneration === generation.current) {
        setCompletedScans(count => count + 1);
        setLastScanAt(Date.now());
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
        if (result.status === 'ordered' && !scanning) {
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
      const confirmedCount = trace.filter(item => item.status === 'ordered').length;
      if (confirmedCount) {
        setAgentFeedback(`Opened ${confirmedCount} contract(s).${outcome?.reason === 'OPEN_CONTRACT_LIMIT' ? ' Open contract limit reached.' : ''}`);
        return;
      }
      const reason = outcome?.reason === 'EARLY_SALE_UNAVAILABLE'
        ? 'Exit target reached. Deriv is not offering an early sale for this position.'
        : outcome?.reason?.replaceAll('_', ' ');
      setAgentFeedback(outcome?.status === 'ordered'
        ? `Order opened on ${outcome.symbol}.`
        : outcome?.status === 'watching' || outcome?.status === 'error'
          ? exitsOnly ? reason || 'Position check complete.' : `No order placed. ${reason || 'No qualifying setup.'}`
          : reason || (outcome ? 'Position check complete.' : 'No account result was returned.'));
    } catch (error) {
      if (requestGeneration !== generation.current) return;
      const message = `${stage} failed. ${error.message || 'Unexpected error.'}`;
      setAgentFeedback(message);
      recordActivity(message);
      if (!exitsOnly && stage.startsWith('Entry check')) {
        window.dispatchEvent(new CustomEvent('playgo:position', { detail: accountId }));
      }
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
      if (stopPending.current || tickPending.current || latestBusy.current || brokerCoolingDown()) return;
      if (!emergencyRetry && time >= entryDue) {
        entryDue = time + checkInterval * 1000;
        exitDue = time + 15_000;
        void latestRun.current();
      } else if (time >= exitDue) {
        exitDue = time + 15_000;
        void latestRun.current(true);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [agentRunning, emergencyRetry, exitSettingsValid, checkInterval, schedulerReady]);

  const startPending = useRef(false);
  async function startAgent() {
    if (startPending.current || stopPending.current || agentBusy || !executionAvailable || !exitSettingsValid) return;
    startPending.current = true;
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
      if (active) {
        setManuallyStopped(false);
        try { localStorage.removeItem('playgo-agent-stop:' + accountId); } catch {}
      }
      setAgentFeedback(active ? 'Bot Agents started.' : statuses[0]?.error || 'The selected account could not be started.');
      recordActivity(active
        ? `Bot Agents started on ${accountLabel} account ${accountId}.`
        : 'Bot Agents did not start; check account and database configuration.');
    } catch (error) {
      setAgentFeedback(error.message || 'Could not start Bot Agents.');
    } finally {
      startPending.current = false;
      setAgentBusy(false);
    }
  }

  const latestStart = useRef(startAgent);
  useEffect(() => { latestStart.current = startAgent; }, [startAgent]);
  const riskPaused = agentStatuses.some(item => item.control?.paused || item.paused || item.control?.stop_reason);
  useEffect(() => {
    if (!autoStartDemo || !controlLoaded || !schedulerReady || !exitSettingsValid ||
        agentRunning || manuallyStopped || riskPaused) return;
    const start = () => { void latestStart.current(); };
    start();
    const retry = setInterval(start, 15000);
    return () => clearInterval(retry);
  }, [autoStartDemo, controlLoaded, schedulerReady, exitSettingsValid, agentRunning, manuallyStopped, riskPaused]);

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
    setManuallyStopped(true);
    try { localStorage.setItem('playgo-agent-stop:' + accountId, '1'); } catch {}
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
      <section className="panel agent-command" data-running={monitoringActive} aria-label="Bot controls">
        <div><h2>Bot control</h2><p role="status">
          {stopping ? 'Stopping bot…' : scan?.running ? 'Scanning markets' : agentBusy ? 'Checking account…' : monitoringActive ? 'Running' : agentRunning ? 'Paused' : 'Standby'}
        </p></div>
        <div className="bot-command-actions">
          <button
            type="button"
            className="primary agent-proposal-button"
            disabled={agentBusy || !executionAvailable || !signalQualifies || !exitSettingsValid}
            onClick={() => setConfirmation('place')}
          >
            {agentBusy ? 'Checking...' : 'Place Trade Now'}
          </button>
          {!agentRunning && <button type="button" className="outline agent-proposal-button" disabled={agentBusy || !executionAvailable || !selectedMarket || !exitSettingsValid} onClick={() => setConfirmation('start')}>Start bot</button>}
          {agentRunning && <button type="button" className="outline" disabled={agentBusy || !selectedMarket} onClick={() => void runAgent()}>{agentBusy ? 'Checking...' : 'Run check now'}</button>}
          <button type="button" className="outline agent-stop" disabled={!agentRunning || stopping}
          onClick={stopAgent}><span aria-hidden="true" className="stop-mark" /> Stop Bot</button>
        </div>
        {agentRunning && nextScanSeconds !== null && <p className="agent-command-feedback">
          {scan?.running ? 'Scanning open markets...' : nextScanSeconds === 0
            ? 'Scan due. Waiting for the active check.'
            : `Next entry scan in ${Math.floor(nextScanSeconds / 60)}:${String(nextScanSeconds % 60).padStart(2, '0')}`}
        </p>}
        {agentFeedback && <p className="agent-command-feedback" role="status">{simpleBotStatus(agentFeedback)}</p>}
        {pendingContracts.length > 0 && <p className="agent-command-feedback">{pendingContracts.length} {pendingContracts.length === 1 ? 'bot trade is' : 'bot trades are'} waiting to settle.</p>}
      </section>
      <section className="panel agent-flow" data-scanning={Boolean(scan?.running)} aria-label="Agent workflow">
        <div className="panelhead"><div><h2>Agent workflow</h2></div></div>
        <ol className="agent-flow-steps">
          <li><strong>Market Scout</strong><small>{scan?.running ? scan.current : scan ? `${scan.checked} market(s) checked` : 'Waiting for next scan'}</small></li>
          <li><strong>Strategy</strong><small>{scan?.rows.at(-1)?.strategy || 'Trend + momentum / breakout'}</small></li>
          <li><strong>Risk</strong><small>{monitoringActive ? 'Monitoring' : 'Standby'}</small></li>
          <li><strong>Execution</strong><small>{scan?.rows.at(-1)?.status === 'ordered' ? 'Order confirmed' : 'Waiting for eligible signal'}</small></li>
        </ol>
        {scan && <div className="agent-scan">
          <div className="agent-progress-heading">
            <strong>{scan.running ? 'Checking with Deriv' : !scan.total ? 'No markets checked' : scan.checked < scan.total ? 'Scan ended early' : `Scan ${completedScans || 1} complete`}</strong>
            <span>{scan.total ? Math.round(scan.checked / scan.total * 100) : 0}% · {scan.checked}/{scan.total}</span>
          </div>
          <progress className={scan.running ? "progress-active" : undefined} aria-label="Markets checked" max={scan.total || 1} value={scan.checked} />
          {!scan.running && <p>
            {lastScanAt && `Last scan ${new Date(lastScanAt).toLocaleTimeString('en-GB', { timeZone: 'Africa/Dar_es_Salaam' })} EAT. `}
            {agentRunning && nextScanSeconds !== null
              ? nextScanSeconds > 0
                ? `Next scan in ${Math.floor(nextScanSeconds / 60)}:${String(nextScanSeconds % 60).padStart(2, '0')}.`
                : 'Next scan is due.'
              : agentRunning ? 'Waiting for the entry scheduler.' : 'Bot is stopped.'}
          </p>}
          {scan.rows.length > 0 && <ul>{scan.rows.map(row => <li key={row.symbol}>
            <strong>{row.name}</strong>
            <span>{row.status === 'ordered' ? 'Order confirmed' : simpleBotStatus(row.reason || row.status || 'No account result')}</span>
            {row.review && <details className="scan-evidence">
              <summary>Decision details</summary>
              <dl className="trade-review">
                <div><dt>Strategy</dt><dd>{row.strategy || 'Unavailable'}</dd></div>
                <div><dt>Signal score</dt><dd>{Number.isFinite(row.score) ? row.score + '/100' : 'Unavailable'}</dd></div>
                <div><dt>Bars received</dt><dd>{row.review.candles}</dd></div>
                <div><dt>Last candle close (EAT)</dt><dd>{row.review.closedAt ? new Date(row.review.closedAt * 1000).toLocaleString('en-GB', { timeZone: 'Africa/Dar_es_Salaam' }) : 'Unverified'}</dd></div>
              </dl>
            </details>}
          </li>)}</ul>}
        </div>}
      </section>
      <section aria-label="Bot results">
        <div className="panelhead"><div><h2>Bot results</h2><p>Tracked on this browser</p></div></div>
        <div className="metrics bot-results">
          <div className="metric"><small>{winningAmounts.length} wins</small><strong className="gain">{botMoney.format(total(winningAmounts))}</strong></div>
          <div className="metric"><small>{losingAmounts.length} losses</small><strong className="loss">{botMoney.format(total(losingAmounts))}</strong></div>
          <div className="metric"><small>{trackedAmounts.length} settled · Net</small><strong>{botMoney.format(total(trackedAmounts))}</strong></div>
        </div>
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
            <div><dt>Markets</dt><dd>Up to {AUTOMATIC_SETUP.marketsPerScan} open markets</dd></div>
            <div><dt>Check interval</dt><dd>{checkInterval} seconds</dd></div>
            <div><dt>{cappedAutomaticStake ? 'Maximum stake' : 'Stop-loss target'}</dt><dd>{useUsdTargets ? (cappedAutomaticStake ? '$' : '-$') + AUTOMATIC_SETUP.stopLossUsd + ' per position' : stopLossValue + '% of stake'}</dd></div>
            <div><dt>Early take-profit trigger</dt><dd>{useUsdTargets ? '+$' + AUTOMATIC_SETUP.takeProfitUsd + ' per position' : takeProfitValue + '% of stake'}</dd></div>
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
          <strong>{analyzing ? 'Checking candles' : analysis.progress === 100 ? '100%' : 'Awaiting data'}</strong>
        </div>
        <progress className={analysis.status === "loading" ? "progress-active" : undefined} max="100" value={analyzing ? undefined : analysis.progress || 0} aria-label="Market analysis progress" />
      </section>

      <details className="agent-inspector"><summary>Agent diagnostics</summary><div className="agent-card-grid">
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
        <AgentCard title="Market data" status={ready ? 'Verified' : analyzing ? 'Analyzing' : 'Waiting'}>
          {ready ? <p>{analysis.bars} closed candles on {selectedMarket.name}. Latest bar closed at {new Date(analysis.reviewAt * 1000).toLocaleTimeString('en-GB', { timeZone: 'Africa/Dar_es_Salaam' })} EAT.</p>
            : <p>{analysis.block ? simpleBotStatus(analysis.block) : 'Checking candle timestamps and prices.'}</p>}
        </AgentCard>
        <AgentCard title="Finance and Account Agents" status={validAccounts?.length ? 'Checked' : 'Unavailable'}>
          {validAccounts?.map((account, index) => {
            const latest = agentStatuses.find(item => item.accountId === account.account_id);
            const equity = latest?.result?.equity ?? latest?.equity;
            const balance = Number(account.balance);
            const nextStake = Number.isFinite(balance) && balance > 0
              ? Math.min(Math.floor(balance * 0.01 * 1e8) / 1e8, cappedAutomaticStake ? AUTOMATIC_SETUP.stopLossUsd : Infinity)
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
          {ready && <p>{analysis.strategy}</p>}
          {ready && <p>Confluence score: {analysis.confluenceScore}/100 · {analysis.bars} bars checked.</p>}


        </AgentCard>
      </div></details>

      {account && <AccountActivity key={account.account_id} accountId={account.account_id} currency={account.currency} />}
      <section className="panel agent-activity">
        <div className="panelhead"><div><h2>Agent activity</h2></div></div>
        {activities.length ? (
          <ol>
            {activities.map((item) => (
              <li key={item.id}>
                <time dateTime={item.at}>{new Date(item.at).toLocaleTimeString()}</time>
                <span>{simpleBotStatus(item.message)}</span>
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
        <p>{cappedAutomaticStake ? 'Up to $10 stake per order.' : 'Up to 1% stake per order.'} Keep Bot Agents open for scheduled checks.</p>
      </ConfirmDialog>}
    </div>
  );
}
