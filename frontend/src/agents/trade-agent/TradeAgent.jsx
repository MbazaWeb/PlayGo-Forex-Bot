import { brokerCoolingDown, brokerRequest, pauseBrokerRequests, simpleBotStatus } from '../../components/brokerRequest.js';
import GoldResearch from '../../components/GoldResearch.jsx';
import AccountActivity from '../../components/AccountActivity.jsx';
import ConfirmDialog from '../../components/ConfirmDialog';
import useStakeLimits from '../../components/useStakeLimits.js';
import { AUTOMATIC_SETUP } from '../../../../shared/agent-analysis.js';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { closedMarketBars, reviewMarket } from '../../../../shared/market-review.js';
import { publicRequest, readMarkets } from '../../components/derivMarkets.js';
import INTERVALS from '../intervals.js';
import RiskAgent from '../risk/RiskAgent.jsx';
import StrategiesAgent from '../strategies/StrategiesAgent.jsx';
import ReminderAgent from '../reminders/ReminderAgent.jsx';
import FinanceAccountAgent from '../finance-account/FinanceAccountAgent.jsx';
import EmergencyAgent from '../emergency/EmergencyAgent.jsx';
import BotAgent from './BotAgent.jsx';
import MarketDataAgent from '../market-data/MarketDataAgent.jsx';

const retryMarketReasons = new Set([
  'STALE_MARKET_DATA', 'UNALIGNED_MARKET_DATA', 'DUPLICATE_MARKET_DATA', 'MARKET_DATA_GAP', 'WEAK_SIGNAL', 'ELEVATED_VOLATILITY', 'BREAKOUT_NOT_CONFIRMED',
  'NO_QUALIFYING_SIGNAL', 'INSUFFICIENT', 'INVALID', 'MARKET_DATA_TIMEOUT',
  'MARKET_DATA_DISCONNECTED', 'MARKET_DATA_UNAVAILABLE', 'MARKET_DATA_SEND_FAILED',
]);

function activityEntry(message) {
  return { id: `${Date.now()}-${Math.random()}`, at: new Date().toISOString(), message };
}

export default function TradeAgent({ account, realExecutionEnabled, marketSymbol, onMarketChange }) {
  const [markets, setMarkets] = useState([]);
  const [catalogState, setCatalogState] = useState('loading');
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const setupKey = account ? 'playgo-agent-setup:' + account.accountRef : null;
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
  const { limits: stakeLimits, error: stakeLimitsError } = useStakeLimits(account?.accountRef);
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
  const [autoStartEnabled, setAutoStartEnabled] = useState(false);
  const [confirmAutoStart, setConfirmAutoStart] = useState(false);
  const [stopLossPercent, setStopLossPercent] = useState('');
  const [takeProfitPercent, setTakeProfitPercent] = useState('');

  useEffect(() => {
    if (!setupKey) return;
    try { localStorage.setItem(setupKey, JSON.stringify({ manual, interval: manualInterval, symbol })); }
    catch { /* Setup remains available for this session. */ }
  }, [setupKey, manual, manualInterval, symbol]);

  const pendingKey = account ? 'playgo:bot-contracts:' + account.accountRef : '';
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

  const total = values => values.reduce((sum, value) => sum + value, 0);
  const botMoney = new Intl.NumberFormat('en-US', {
    style: 'currency', currency: account?.currency || 'USD', signDisplay: 'exceptZero',
  });
  const [brokerResults, setBrokerResults] = useState(null);
  const brokerRows = brokerResults?.rows ?? [];
  const winningRows = brokerRows.filter(row => row.value > 0);
  const losingRows = brokerRows.filter(row => row.value < 0);
  const evenRows = brokerRows.filter(row => row.value === 0);
  const resultValues = brokerRows.map(row => row.value);

  const trackContract = useCallback(id => {
    if (id) window.dispatchEvent(new CustomEvent('playgo:position', { detail: account?.accountRef }));
    if (id) setPendingContracts(previous => previous.includes(String(id)) ? previous : [...previous, String(id)]);
  }, [account?.accountRef]);

  const recordActivity = useCallback((message) => {
    setActivities((previous) => [activityEntry(message), ...previous].slice(0, 8));
  }, []);

  useEffect(() => {
    if (!account?.accountRef || !pendingContracts.length) return;
    const id = account.accountRef;
    const controller = new AbortController();
    let timer;
    async function checkSettlements() {
      try {
        const response = await brokerRequest('/api/history', { signal: controller.signal });
        if (!response.ok) return;
        const body = await response.json();
        if (controller.signal.aborted || body.accountRef !== id || !Array.isArray(body.transactions)) return;
        const settled = new Set();
        for (const row of body.transactions) {
          if (pendingContracts.includes(row.contractId)) settled.add(row.contractId);
        }
        if (settled.size) {
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
  }, [account?.accountRef, pendingContracts]);

  useEffect(() => {
    if (!account?.accountRef) {
      setBrokerResults(null);
      return undefined;
    }
    const id = account.accountRef;
    const controller = new AbortController();
    let timer;
    let refreshing = false;
    let pending = false;
    async function refresh() {
      if (refreshing) { pending = true; return; }
      refreshing = true;
      try {
        const response = await brokerRequest('/api/history?report=1', {
          signal: controller.signal,
          cache: 'no-store',
        });
        const body = await response.json();
        if (!response.ok || body.accountRef !== id || !Array.isArray(body.transactions) ||
            !body.evidence || typeof body.evidence !== 'object')
          throw new Error(body.error || 'Broker settlement results unavailable.');
        const rows = body.transactions.filter(row => {
          const evidence = body.evidence[row.contractId];
          return evidence?.execution?.status === 'confirmed' &&
            typeof evidence?.strategyId === 'string' &&
            Number.isFinite(row.buy) && Number.isFinite(row.sell);
        }).map(row => ({
          value: Number((row.sell - row.buy).toFixed(8)),
          outcome: row.sell >= row.buy ? 'won' : 'lost',
        }));
        if (!controller.signal.aborted) setBrokerResults({ rows });
      } catch {
        if (!controller.signal.aborted) setBrokerResults({ error: true, rows: [] });
      } finally {
        refreshing = false;
        if (!controller.signal.aborted) {
          timer = setTimeout(refresh, pending ? 0 : 15_000);
          pending = false;
        }
      }
    }
    function onSettlement(event) {
      if (event.detail === id) void refresh();
    }
    window.addEventListener('playgo:settlement', onSettlement);
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
      window.removeEventListener('playgo:settlement', onSettlement);
    };
  }, [account?.accountRef]);

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
  const accountRef = account?.accountRef;
  const accountDisplay = account?.maskedAccountId || 'selected account';
  const [controlLoaded, setControlLoaded] = useState(false);
  const [manuallyStopped, setManuallyStopped] = useState(() => {
    try { return localStorage.getItem('playgo-agent-stop:' + accountRef) === '1'; }
    catch { return false; }
  });
  const accountLabel = account?.account_type === 'real' ? 'Real' : 'Demo';
  const executionAvailable = Boolean(accountRef) && (accountLabel === 'Demo' || realExecutionEnabled);
  const accountSummary = accountRef
    ? `${accountLabel} account ${accountDisplay} selected.`
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
    const query = new URLSearchParams({ ...params, mode: manual ? 'manual' : 'automatic' });
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
  }, [manual]);

  useEffect(() => {
    if (!accountRef) {
      setAgentStatuses([]);
      setAgentRunning(false);
      return undefined;
    }
    const controller = new AbortController();
    let retry;
    function loadControl() {
      brokerRequest('/api/agent/status', {
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
        const status = statuses.find(item => item.accountRef === accountRef);
        if (!status || status.error) throw Error(status?.error || 'Account status unavailable.');
        setControlLoaded(true);
        setAgentStatuses(statuses);
        setAutoStartEnabled(status.autoStartEnabled === true);
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
  }, [accountRef]);

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
        window.dispatchEvent(new CustomEvent('playgo:settlement', { detail: accountRef }));
      }
      if (requestGeneration !== generation.current) return;
      const activeResults = results.some(item =>
        ['watching', 'ordered', 'exited', 'error'].includes(item.status) ||
        (item.status === 'stopped' && item.reason === 'DRAWDOWN_LIMIT' && item.closeResults?.length > 0),
      );
      setAgentRunning(activeResults);
      setAgentStatuses(results.map(item => ({
        accountRef: item.accountRef,
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
        window.dispatchEvent(new CustomEvent('playgo:position', { detail: accountRef }));
      }
    } finally {
      tickPending.current = false;
      setScan(previous => previous?.running ? { ...previous, running: false } : previous);
      setAgentBusy(false);
    }
  }, [accountRef, accountLabel, agentBusy, emergencyRetry, executionAvailable, exitSettingsValid, interval, postAgentAction, recordActivity, selectedMarket, stopLossValue, takeProfitValue, validAccounts, trackContract, manual]);

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
        try { localStorage.removeItem('playgo-agent-stop:' + accountRef); } catch {}
      }
      setAgentFeedback(active ? 'Bot Agents started.' : statuses[0]?.error || 'The selected account could not be started.');
      recordActivity(active
        ? `Bot Agents started on ${accountLabel} account ${accountDisplay}.`
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
    if (!autoStartEnabled || !controlLoaded || !schedulerReady || !exitSettingsValid ||
        agentRunning || manuallyStopped || riskPaused) return;
    const start = () => { void latestStart.current(); };
    start();
    const retry = setInterval(start, 15000);
    return () => clearInterval(retry);
  }, [autoStartEnabled, controlLoaded, schedulerReady, exitSettingsValid, agentRunning, manuallyStopped, riskPaused]);

  async function saveAutoStart(enabled) {
    setAgentBusy(true);
    setAgentFeedback('');
    try {
      const body = await postAgentAction('preferences', {
        enabled: enabled ? '1' : '0',
        ...(enabled && account?.account_type === 'real' ? { confirmReal: '1' } : {}),
      });
      if (body.accountRef !== accountRef) throw new Error('Auto-start setting was not confirmed for this account.');
      setAutoStartEnabled(body.autoStartEnabled === true);
      setAgentFeedback(body.autoStartEnabled ? 'Auto-start enabled for this account.' : 'Auto-start disabled for this account.');
    } catch (error) {
      setAgentFeedback(error.message || 'Could not save auto-start preference.');
    } finally {
      setAgentBusy(false);
    }
  }

  function changeAutoStart(enabled) {
    if (enabled && account?.account_type === 'real') {
      setConfirmAutoStart(true);
      return;
    }
    void saveAutoStart(enabled);
  }

  async function placeTradeNow() {
    if (agentBusy || !executionAvailable || !stakeLimits || !selectedMarket || !ready ||
        !signalQualifies || !exitSettingsValid) return;
    setAgentBusy(true);
    setAgentFeedback('');
    try {
      // The server applies the same verified stake calculation to every order surface.
      const body = await postAgentAction('place', {
        symbol: selectedMarket.symbol,
        granularity: String(interval),
        stopLossPercent: String(stopLossValue),
        takeProfitPercent: String(takeProfitValue),
        terminalAction: 'bot',
      });
      const results = Array.isArray(body.accounts) ? body.accounts : [];
      const active = results.some(item =>
        item.automationActive === true ||
        item.automationActive === null ||
        (item.status === 'stopped' && item.reason === 'DRAWDOWN_LIMIT' && item.closeResults?.length > 0),
      );
      setAgentRunning(active);
      setAgentStatuses(results.map(item => ({
        accountRef: item.accountRef,
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
        ? `Trade check completed for ${accountLabel} account ${accountDisplay}. Bot Agents remain active after a successful order.`
        : 'No account result was returned.');
    } catch (error) {
      setAgentFeedback(error.message || 'Could not place the one-time trade.');
      recordActivity('One-time trade request failed; no success was assumed.');
    } finally {
      setAgentBusy(false);
    }
  }

  async function stopAgent() {
    if (!accountRef || stopPending.current) return;
    stopPending.current = true;
    setManuallyStopped(true);
    try { localStorage.setItem('playgo-agent-stop:' + accountRef, '1'); } catch {}
    generation.current++;
    setStopping(true);
    try {
      const body = await postAgentAction('stop');
      const state = body.accounts?.find(item => item.accountRef === accountRef);
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
            disabled={agentBusy || !executionAvailable || !stakeLimits || !signalQualifies || !exitSettingsValid}
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
      <GoldResearch market={markets.find(market => /^(?:frx)?XAUUSD$/i.test(market.symbol))} catalogLoading={catalogState === "loading"} />
      <section aria-label="Bot results">
        <div className="panelhead"><div><h2>Bot results</h2><p>Recent Deriv settlements with recorded bot strategy evidence</p></div></div>
        {brokerResults?.error
          ? <p role="status">Broker-confirmed bot results are unavailable. Local browser values are not used as a financial source.</p>
          : brokerResults
            ? <div className="metrics bot-results">
                <div className="metric"><small>{winningRows.length} wins · verified</small><strong className="gain">{botMoney.format(total(winningRows.map(row => row.value)))}</strong></div>
                <div className="metric"><small>{losingRows.length} losses · verified</small><strong className="loss">{botMoney.format(total(losingRows.map(row => row.value)))}</strong></div>
                <div className="metric"><small>{brokerRows.length} settled · {evenRows.length} break-even</small><strong>{botMoney.format(total(resultValues))}</strong></div>
              </div>
            : <p role="status">Loading Deriv settlement history…</p>}
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
        <label className="auto-start-setting">
          <input type="checkbox" checked={autoStartEnabled} disabled={!controlLoaded || agentBusy}
            onChange={event => changeAutoStart(event.target.checked)} />
          <span>Allow Bot Agents to auto-start on this account</span>
        </label>
        <p>Auto-start is off by default. Real-account auto-start requires confirmation each time it is enabled.</p>
        {!manual && (
          <dl className="agent-setup-summary">
            <div><dt>Markets</dt><dd>Up to {AUTOMATIC_SETUP.marketsPerScan} open markets</dd></div>
            <div><dt>Check interval</dt><dd>{checkInterval} seconds</dd></div>
            <div><dt>Server-calculated stake</dt><dd>{stakeLimits ? `${stakeLimits.stake} ${stakeLimits.currency} (maximum ${stakeLimits.maxStake.toFixed(2)} ${stakeLimits.currency})` : stakeLimitsError ? 'Unavailable; orders blocked' : 'Loading'}</dd></div>
            <div><dt>Stop-loss trigger</dt><dd>{stopLossValue}% of stake · early-exit request only</dd></div>
            <div><dt>Take-profit trigger</dt><dd>{takeProfitValue}% of stake · early-exit request only</dd></div>
          </dl>
        )}
        <p>Deriv may not offer early sale for a contract. A stop-loss cannot guarantee a smaller realized loss; size every trade assuming the full stake can be lost.</p>
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
        {accountRef && !executionAvailable && <p role="status">Real-money execution is disabled on the server.</p>}
        {!exitSettingsValid && <p role="status">Enter valid stop-loss and take-profit percentages to enable trading.</p>}
      </section>

      <section className="panel agent-progress" aria-live="polite">
        <div className="agent-progress-heading">
          <h2>Analysis progress</h2>
          <strong>{analyzing ? 'Checking candles' : analysis.progress === 100 ? '100%' : 'Awaiting data'}</strong>
        </div>
        <progress className={analysis.status === "loading" ? "progress-active" : undefined} max="100" value={analyzing ? undefined : analysis.progress || 0} aria-label="Market analysis progress" />
      </section>

      <details className="agent-inspector">
        <summary>Agent diagnostics</summary>
        <div className="agent-card-grid">
          <RiskAgent analysis={analysis} ready={ready} analyzing={analyzing} />
          <StrategiesAgent analysis={analysis} ready={ready} analyzing={analyzing} />
          <MarketDataAgent analysis={analysis} market={selectedMarket} ready={ready} analyzing={analyzing} formatStatus={simpleBotStatus} />
          <ReminderAgent analysis={analysis} ready={ready} interval={interval} />
          <FinanceAccountAgent accounts={validAccounts || []} agentStatuses={agentStatuses} stakeLimits={stakeLimits} />
          <EmergencyAgent monitoringActive={monitoringActive} agentRunning={agentRunning} />
          <BotAgent monitoringActive={monitoringActive} agentRunning={agentRunning} ready={ready} analyzing={analyzing} recommendation={recommendation} analysis={analysis} />
        </div>
      </details>

      {account && <AccountActivity key={account.accountRef} accountRef={account.accountRef} currency={account.currency} />}
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
        <p>{selectedMarket?.name || 'Selected market'} on Deriv {accountLabel} account {accountDisplay}.</p>
        <p>Server-calculated stake: {stakeLimits ? `${stakeLimits.stake} ${stakeLimits.currency} (maximum ${stakeLimits.maxStake.toFixed(2)} ${stakeLimits.currency})` : 'unavailable; orders are blocked'}.</p>
        <p>Stop-loss is an early-exit request. Deriv may not offer early sale, so the full stake can be lost. Keep Bot Agents open for scheduled checks.</p>
      </ConfirmDialog>}
      {confirmAutoStart && <ConfirmDialog title="Enable real-account auto-start" confirmLabel="Confirm and enable"
        onCancel={() => setConfirmAutoStart(false)}
        onConfirm={() => { setConfirmAutoStart(false); void saveAutoStart(true); }}>
        <p>Bot Agents may start automatically on real account {accountDisplay} when its risk checks allow it.</p>
        <p>This does not guarantee a stop-loss exit. The full stake can be lost; the server live switch and risk gates remain required.</p>
      </ConfirmDialog>}
    </div>
  );
}
