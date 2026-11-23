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

export default function TradeAgent({ accounts }) {
  const [markets, setMarkets] = useState([]);
  const [catalogState, setCatalogState] = useState('loading');
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [symbol, setSymbol] = useState('R_75');
  const [interval, setInterval] = useState(60);
  const [refresh, setRefresh] = useState(0);
  const [analysis, setAnalysis] = useState({ status: 'waiting', progress: 0 });
  const [activities, setActivities] = useState([]);
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentStatuses, setAgentStatuses] = useState([]);
  const [agentFeedback, setAgentFeedback] = useState('');
  const [stopLossPercent, setStopLossPercent] = useState('');
  const [takeProfitPercent, setTakeProfitPercent] = useState('');

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
    () => markets.find((market) => market.symbol === symbol) || markets[0] || null,
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
        setAnalysis({ ...result, progress: 100, symbol: selectedMarket.symbol });
        recordActivity(result.status === 'ready'
          ? `${result.direction ? `${result.direction} setup` : 'No qualifying setup'}; confluence ${result.confluenceScore}/100.`
          : result.reason);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setAnalysis({ status: 'error', progress: 100, symbol: selectedMarket.symbol });
        recordActivity(`Analysis failed for ${selectedMarket.symbol}; market data was unavailable.`);
      });

    return () => controller.abort();
  }, [selectedMarket, interval, refresh, recordActivity]);

  const validAccounts = useMemo(() => Array.isArray(accounts)
    ? accounts.filter((account) => account?.account_type === 'real' &&
      typeof account?.account_id === 'string' && account.account_id)
    : null, [accounts]);
  const accountSummary = validAccounts === null
    ? 'Account status unavailable.'
    : validAccounts.length
      ? `${validAccounts.length} connected account record${validAccounts.length === 1 ? '' : 's'} checked.`
      : 'No connected account records.';
  const ready = analysis.status === 'ready';
  const analyzing = analysis.status === 'loading' || catalogState === 'loading';
  const stopLossValue = Number(stopLossPercent);
  const takeProfitValue = Number(takeProfitPercent);
  const exitSettingsValid = Number.isFinite(stopLossValue) && stopLossValue > 0 && stopLossValue <= 100 &&
    Number.isFinite(takeProfitValue) && takeProfitValue > 0 && takeProfitValue <= 10000;
  const emergencyRetry = agentStatuses.some(item => item.control?.stop_reason === 'DRAWDOWN_LIMIT');
  const monitoringActive = agentRunning && (exitSettingsValid || emergencyRetry);
  const signalQualifies = ready && Boolean(analysis.direction) && analysis.confluenceScore >= 75;
  const recommendation = ready
    ? analysis.direction
      ? `${analysis.direction === 'bullish' ? 'Bullish' : 'Bearish'} setup to review`
      : 'No setup meets the 75/100 threshold'
    : analysis.status === 'error'
      ? 'Waiting for live market data'
      : analysis.status === 'insufficient'
        ? 'More candles needed'
        : 'Analysis not ready';

  const postAgentAction = useCallback(async (path, params = {}) => {
    const query = new URLSearchParams(params);
    const response = await fetch(`/api/agent/${path}${query.size ? `?${query}` : ''}`, {
      method: 'POST',
      headers: { 'X-PlayGo-Request': '1' },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error || 'Agent request failed.');
    return body;
  }, []);

  useEffect(() => {
    if (!validAccounts?.length) {
      setAgentStatuses([]);
      setAgentRunning(false);
      return undefined;
    }
    const controller = new AbortController();
    fetch('/api/agent/status', { signal: controller.signal })
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
  }, [validAccounts]);

  const runAgent = useCallback(async () => {
    if (!selectedMarket || !validAccounts?.length ||
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
          recordActivity(`Real order confirmed for ${result.symbol}; stake ${result.stake} (${result.score}/100 confluence).`);
        } else if (result.status === 'exited') {
          recordActivity(`Stop-loss or take-profit threshold reached; sell requests sent for ${result.closeResults?.length || 0} contract(s).`);
        } else if (result.status === 'stopped') {
          recordActivity(`Emergency Agent stopped trading: ${result.reason}. Close requests were attempted where applicable.`);
        } else if (result.status === 'error') {
          recordActivity(`Agent could not complete its run: ${result.reason}.`);
        }
      }
      setAgentFeedback(results.length
        ? `Checked ${results.length} real account${results.length === 1 ? '' : 's'}.`
        : 'No real accounts are available.');
    } catch (error) {
      setAgentFeedback(error.message || 'Agent run failed.');
      recordActivity('Agent run failed; no success was assumed.');
    } finally {
      setAgentBusy(false);
    }
  }, [agentBusy, emergencyRetry, exitSettingsValid, interval, postAgentAction, recordActivity, selectedMarket, stopLossValue, takeProfitValue, validAccounts]);

  useEffect(() => {
    if (!agentRunning || (!exitSettingsValid && !emergencyRetry)) return undefined;
    const timer = setInterval(() => { void runAgent(); }, interval * 1000);
    return () => clearInterval(timer);
  }, [agentRunning, emergencyRetry, exitSettingsValid, interval, runAgent]);

  async function startAgent() {
    if (agentBusy || !validAccounts?.length || !exitSettingsValid) return;
    if (!window.confirm(`Start Bot Agents on all ${validAccounts.length} connected real accounts? Orders require a qualifying signal. Stake is 1% of each live balance; stop and target exits are best-effort.`)) return;
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
      setAgentFeedback(active ? 'Bot Agents started.' : 'No real account could be started.');
      recordActivity(active
        ? `Bot Agents started for ${statuses.filter(item => item.active).length} real account(s).`
        : 'Bot Agents did not start; check account and database configuration.');
    } catch (error) {
      setAgentFeedback(error.message || 'Could not start Bot Agents.');
    } finally {
      setAgentBusy(false);
    }
  }

  async function placeTradeNow() {
    if (agentBusy || !validAccounts?.length || !selectedMarket || !ready ||
        !signalQualifies || !exitSettingsValid) return;
    if (!window.confirm(`Place a real-money order on all ${validAccounts.length} connected real accounts if server-side analysis and risk checks still qualify? After a successful order, Bot Agents will stay active for monitoring and may place later qualifying trades until stopped.`)) return;
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
          recordActivity(`Real order confirmed for ${result.symbol}; stake ${result.stake} (${result.score}/100 confluence). Bot Agents remain active for monitoring and scheduled checks.`);
        } else if (result.status === 'exited') {
          recordActivity(`Stop-loss or take-profit threshold reached; sell requests sent for ${result.closeResults?.length || 0} contract(s).`);
        } else {
          recordActivity(`One-time trade not placed: ${result.reason || result.status}.`);
        }
      }
      setAgentFeedback(results.length
        ? `Trade check completed for ${results.length} real account(s). Bot Agents remain active after any successful order.`
        : 'No real accounts are available.');
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
            <h2>Live market analysis</h2>
            <p>Public market data; analysis is independent of account type.</p>
          </div>
          <button
            className="outline"
            disabled={analyzing || catalogState === 'error'}
            onClick={() => setRefresh((value) => value + 1)}
          >
            {analyzing ? 'Analyzing...' : 'Analyze again'}
          </button>
        </div>
        {catalogState === 'error' ? (
          <p role="alert">
            Market list unavailable.{' '}
            <button className="textlink" onClick={() => setCatalogAttempt((value) => value + 1)}>Retry</button>
          </p>
        ) : (
          <div className="agent-control-row">
            <label>
              Market
              <select
                value={selectedMarket?.symbol || ''}
                disabled={!markets.length || analyzing}
                onChange={(event) => setSymbol(event.target.value)}
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
                disabled={analyzing}
                onChange={(event) => setInterval(Number(event.target.value))}
              >
                {INTERVALS.map(([seconds, title]) => (
                  <option key={seconds} value={seconds}>{title}</option>
                ))}
              </select>
            </label>
          </div>
        )}
        <div className="agent-control-row">
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
        </div>
        <p>Stake is automatically 1% of each account's verified balance. Bot checks run on the selected candle interval while this page is open.</p>
        <p>Deriv execution uses a live proposal followed by a buy at the quoted maximum price. FOK is not supported. Stop-loss and take-profit use monitored sell requests and are not guaranteed.</p>
        {!exitSettingsValid && <p role="status">Enter valid stop-loss and take-profit percentages to enable trading.</p>}
      </section>

      <section className="panel agent-progress" aria-live="polite">
        <div className="agent-progress-heading">
          <h2>Analysis progress</h2>
          <strong>{analysis.progress || 0}%</strong>
        </div>
        <progress max="100" value={analysis.progress || 0} aria-label="Market analysis progress" />
        <p>Signal threshold: 75/100.</p>
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
          <p>{accountSummary} Stake sizing uses 1% of each broker-reported balance. Account equity includes floating contract P&L.</p>
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
            disabled={agentBusy || !validAccounts?.length || !signalQualifies || !exitSettingsValid}
            onClick={() => void placeTradeNow()}
          >
            {agentBusy ? 'Checking...' : 'Place Trade Now'}
          </button>
          {agentRunning
            ? <button type="button" className="outline agent-proposal-button" disabled={agentBusy} onClick={stopAgent}>Stop trading</button>
            : <button type="button" className="outline agent-proposal-button" disabled={agentBusy || !validAccounts?.length || !selectedMarket || !exitSettingsValid} onClick={startAgent}>Start scheduled trading</button>}
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
    </div>
  );
}
