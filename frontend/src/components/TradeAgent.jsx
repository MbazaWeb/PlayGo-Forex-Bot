import ConfirmDialog from './ConfirmDialog';
import { AUTOMATIC_SETUP, automaticEntryBlock } from '../../../shared/agent-analysis.js';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { analyzeCandles } from './agentAnalysis.js';
import { publicRequest, readCandles, readMarkets } from './derivMarkets.js';

const INTERVALS = [
  [60, '1 minute'],
  [300, '5 minutes'],
  [900, '15 minutes'],
  [3600, '1 hour'],
];

function AgentCard({ title, status, children }) {
  return (
    <section className="panel agent-card">
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

  const recordActivity = useCallback((message) => {
    setActivities((previous) => [activityEntry(message), ...previous].slice(0, 8));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setCatalogState('loading');
    recordActivity('Loading the live market list.');
    publicRequest({ active_symbols: 'brief' }, controller.signal)
      .then(readMarkets)
      .then((rows) => {
        if (controller.signal.aborted) return;
        if (!rows.length) throw new Error('No markets returned.');
        setMarkets(rows);
        setCatalogState('ready');
        recordActivity(`Market list loaded: ${rows.length} symbols.`);
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
    recordActivity(`Requesting ${selectedMarket.symbol} candle data.`);

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
        recordActivity(`Received ${candles.length} valid candles for ${selectedMarket.symbol}.`);
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
    if (!validAccounts?.length) {
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
        const allMatch = statuses.length === validAccounts.length &&
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
  }, [accountId, validAccounts]);

  const runAgent = useCallback(async () => {
    if (!executionAvailable || !selectedMarket ||
        (!exitSettingsValid && !emergencyRetry) || agentBusy) return;
    setAgentBusy(true);
    try {
      const body = await postAgentAction('run', {
        symbol: selectedMarket.symbol,
        granularity: String(interval),
      });
      const results = Array.isArray(body.accounts) ? body.accounts : [];
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
          recordActivity(`Deriv ${accountLabel} order confirmed for ${result.symbol}; stake ${result.stake} (${result.score}/100 confluence).`);
        } else if (result.status === 'exited') {
          recordActivity(`Stop-loss or take-profit threshold reached; sell requests sent for ${result.closeResults?.length || 0} contract(s).`);
        } else if (result.status === 'stopped') {
          recordActivity(`Emergency Agent stopped trading: ${result.reason}. Close requests were attempted where applicable.`);
        } else if (result.status === 'error') {
          recordActivity(`Agent could not complete its run: ${result.reason}.`);
        }
      }
      setAgentFeedback(results.length
        ? `Checked Deriv ${accountLabel} account ${accountId}.`
        : 'No account result was returned.');
    } catch (error) {
      setAgentFeedback(error.message || 'Agent run failed.');
      recordActivity('Agent run failed; no success was assumed.');
    } finally {
      setAgentBusy(false);
    }
  }, [accountId, accountLabel, agentBusy, emergencyRetry, executionAvailable, exitSettingsValid, interval, postAgentAction, recordActivity, selectedMarket, stopLossValue, takeProfitValue, validAccounts]);

  useEffect(() => {
    if (!agentRunning || (!exitSettingsValid && !emergencyRetry)) return undefined;
    const timer = setInterval(() => { void runAgent(); }, interval * 1000);
    return () => clearInterval(timer);
  }, [agentRunning, emergencyRetry, exitSettingsValid, interval, runAgent]);

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
          recordActivity(`Deriv ${accountLabel} order confirmed for ${result.symbol}; stake ${result.stake} (${result.score}/100 confluence). Bot Agents remain active for monitoring and scheduled checks.`);
        } else if (result.status === 'exited') {
          recordActivity(`Stop-loss or take-profit threshold reached; sell requests sent for ${result.closeResults?.length || 0} contract(s).`);
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
    if (agentBusy) return;
    setAgentBusy(true);
    try {
      const body = await postAgentAction('stop');
      setAgentStatuses(Array.isArray(body.accounts) ? body.accounts : []);
      setAgentRunning(false);
      setAgentFeedback('New automatic orders stopped.');
      recordActivity('Bot Agents stopped; no new automatic orders will be requested.');
    } catch (error) {
      setAgentFeedback(error.message || 'Could not stop Bot Agents.');
    } finally {
      setAgentBusy(false);
    }
  }

  return (
    <div className="trade-agent-dashboard">
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
        <p>Stake is automatically 1% of the selected account's verified balance. Bot checks run on the selected candle interval while this page is open.</p>
        <p>Exit targets trigger sell requests. The price and execution depend on Deriv.</p>
        {!exitSettingsValid && <p role="status">Enter valid stop-loss and take-profit percentages to enable trading.</p>}
      </section>

      <section className="panel agent-progress" aria-live="polite">
        <div className="agent-progress-heading">
          <h2>Analysis progress</h2>
          <strong>{analysis.progress || 0}%</strong>
        </div>
        <progress max="100" value={analysis.progress || 0} aria-label="Market analysis progress" />
        <p>Entry score required {manual ? 75 : AUTOMATIC_SETUP.minimumScore}/100. {!manual && 'Automatic entries also pause during elevated volatility.'}</p>
      </section>

      <div className="agent-card-grid">
        <AgentCard title="Risk Agent" status={ready ? 'Updated' : analyzing ? 'Analyzing' : 'Waiting'}>
          {ready
            ? <p>{analysis.riskLevel} volatility · {analysis.volatilityPct.toFixed(4)}% average absolute move per bar.</p>
            : <p>Waiting for enough valid market candles.</p>}
        </AgentCard>
        <AgentCard title="Strategies Agent" status={ready ? 'Updated' : analyzing ? 'Analyzing' : 'Waiting'}>
          {ready
            ? <p>SMA 20 {analysis.sma20.toFixed(5)} · SMA 50 {analysis.sma50.toFixed(5)} · RSI {analysis.rsi.toFixed(1)} · momentum {analysis.momentumPct.toFixed(3)}%.</p>
            : <p>Trend, momentum, and RSI checks will appear after analysis.</p>}
        </AgentCard>
        <AgentCard title="Reminder Agent" status={ready ? 'Ready' : 'Waiting'}>
          {ready
            ? <p>Review after the next {INTERVALS.find(([seconds]) => seconds === interval)?.[1]} candle, around {new Date(analysis.reviewAt * 1000).toLocaleTimeString()}.</p>
            : <p>Reminder timing is based on the latest retrieved candle.</p>}
        </AgentCard>
        <AgentCard title="Finance and Account Agents" status={validAccounts?.length ? 'Checked' : 'Unavailable'}>
          <p>{accountSummary} Stake sizing uses 1% of the broker-reported balance. Account equity includes floating contract P&L.</p>
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
          <p>Stops new orders at 20% drawdown from the starting balance and attempts to close open contracts.</p>
          <p>Monitoring runs while this page is open.</p>
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
          {agentRunning
            ? <button type="button" className="outline agent-proposal-button" disabled={agentBusy} onClick={stopAgent}>Stop trading</button>
            : <button type="button" className="outline agent-proposal-button" disabled={agentBusy || !executionAvailable || !selectedMarket || !exitSettingsValid} onClick={() => setConfirmation('start')}>Start scheduled trading</button>}
          {agentRunning && <button type="button" className="outline" disabled={agentBusy || !selectedMarket} onClick={() => void runAgent()}>{agentBusy ? 'Checking...' : 'Run check now'}</button>}
          {agentFeedback && <p className="agent-trade-feedback" role="status">{agentFeedback}</p>}
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
        <p>Orders require a qualifying signal. Each order stakes 1% of the balance. The bot may place later qualifying orders until stopped.</p>
      </ConfirmDialog>}
    </div>
  );
}
