import { isDerivAccount } from './deriv-account.js';
const API = 'https://api.derivws.com';

function codedError(code) {
  const error = Error(code);
  error.code = code;
  return error;
}

export async function getRealWebSocketUrl({ token, account, appId, fetchImpl = fetch }) {
  if (!token || !isDerivAccount(account))
    throw codedError('REAL_ACCOUNT_REQUIRED');

  const response = await fetchImpl(
    API + '/trading/v1/options/accounts/' + encodeURIComponent(account.account_id) + '/otp',
    {
      method: 'POST',
      redirect: 'error',
      headers: {
        Authorization: 'Bearer ' + token,
        ...(appId ? { 'Deriv-App-ID': String(appId) } : {}),
      },
      signal: AbortSignal.timeout(10000),
    },
  );
  if (response.status === 401) throw codedError('DERIV_SESSION_EXPIRED');
  if (response.status === 429) throw codedError('DERIV_RATE_LIMIT');
  if (!response.ok) throw codedError('REAL_OTP_FAILED');

  const body = await response.json();
  const value = body?.data?.url;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw codedError('INVALID_REAL_ENDPOINT');
  }
  if (url.protocol !== 'wss:' || url.host !== 'api.derivws.com' ||
      url.pathname !== `/trading/v1/options/ws/${account.account_type}` || !url.searchParams.get('otp') ||
      url.username || url.password || url.hash)
    throw codedError('INVALID_REAL_ENDPOINT');
  return url.toString();
}

function openSocket(Socket, url) {
  return new Promise((resolve, reject) => {
    let socket;
    let settled = false;
    const timer = setTimeout(() => finish(codedError('BROKER_CONNECT_TIMEOUT')), 10000);
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        try { socket?.close(); } catch {}
        reject(error);
      } else {
        resolve(socket);
      }
    }
    try {
      socket = new Socket(url);
    } catch {
      finish(codedError('BROKER_CONNECT_FAILED'));
      return;
    }
    socket.onopen = () => finish();
    socket.onerror = () => finish(codedError('BROKER_CONNECT_FAILED'));
    socket.onclose = () => {
      if (!settled) finish(codedError('BROKER_CONNECT_FAILED'));
    };
  });
}

function sendAndWait(socket, payload, expectedType, reqId) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish(codedError('BROKER_REQUEST_TIMEOUT')), 10000);
    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    }
    socket.onmessage = event => {
      let response;
      try {
        response = JSON.parse(String(event.data));
      } catch {
        finish(codedError('INVALID_BROKER_RESPONSE'));
        return;
      }
      if (response.req_id !== reqId) return;
      if (response.error) {
        const brokerCode = response.error.code;
        const stage = expectedType === 'proposal' ? 'PROPOSAL' : expectedType.toUpperCase();
        const suffix = typeof brokerCode === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(brokerCode)
          ? '_' + brokerCode
          : '';
        const error = codedError('DERIV_' + stage + '_REJECTED' + suffix);
        if (stage === 'PROPOSAL' && typeof response.error.message === 'string')
          error.proposalDetail = response.error.message.replace(/https?:\/\/\S+/gi, '[link]').replace(/\s+/g, ' ').trim().slice(0, 240);
        finish(error);
        return;
      }
      if (response.msg_type !== expectedType) {
        finish(codedError('INVALID_BROKER_RESPONSE'));
        return;
      }
      finish(null, response);
    };
    socket.onerror = () => finish(codedError('BROKER_DISCONNECTED'));
    socket.onclose = () => finish(codedError('BROKER_DISCONNECTED'));
    try {
      socket.send(JSON.stringify({ ...payload, req_id: reqId }));
    } catch {
      finish(codedError('BROKER_DISCONNECTED'));
    }
  });
}

async function withRealSocket(options, callback) {
  const Socket = options.Socket || globalThis.WebSocket;
  if (typeof Socket !== 'function') throw codedError('WEBSOCKET_UNAVAILABLE');
  const url = await getRealWebSocketUrl(options);
  const socket = await openSocket(Socket, url);
  try {
    return await callback(socket);
  } finally {
    try { socket.close(); } catch {}
  }
}

function validIntent(intent, account) {
  return isDerivAccount(account) &&
    /^[A-Za-z0-9_]{2,30}$/.test(intent?.symbol || '') &&
    ['CALL', 'PUT'].includes(intent?.contractType) &&
    /^[A-Z]{3}$/.test(account.currency || '') &&
    Number.isFinite(intent?.stake) && intent.stake > 0 &&
    Number.isSafeInteger(intent?.duration) && intent.duration >= 1 && intent.duration <= 60 &&
    intent.durationUnit === 'm';
}

export async function executeRealOrder({
  account, token, appId, intent, beforeBuy, fetchImpl = fetch, Socket,
}) {
  if (!validIntent(intent, account)) throw codedError('INVALID_REAL_ORDER');
  if (typeof beforeBuy !== 'function') throw codedError('PERSISTED_SUBMISSION_REQUIRED');

  return withRealSocket({ token, account, appId, fetchImpl, Socket }, async socket => {
    const proposal = await sendAndWait(socket, {
      proposal: 1,
      amount: intent.stake,
      basis: 'stake',
      contract_type: intent.contractType,
      currency: account.currency,
      duration: intent.duration,
      duration_unit: intent.durationUnit,
      underlying_symbol: intent.symbol,
    }, 'proposal', 1);
    const proposalId = proposal?.proposal?.id;
    const ask = Number(proposal?.proposal?.ask_price);
    if ((typeof proposalId !== 'string' && !Number.isSafeInteger(proposalId)) ||
        !Number.isFinite(ask) || ask <= 0 || ask > intent.stake)
      throw codedError('INVALID_BROKER_PROPOSAL');

    await beforeBuy();
    let result;
    try {
      result = await sendAndWait(socket, { buy: proposalId, price: ask }, 'buy', 2);
    } catch {
      throw codedError('BROKER_ORDER_OUTCOME_UNKNOWN');
    }
    const contractId = result?.buy?.contract_id;
    if (!(typeof contractId === 'string' || Number.isSafeInteger(contractId)) ||
        !/^[0-9]{1,30}$/.test(String(contractId)))
      throw codedError('BROKER_ORDER_OUTCOME_UNKNOWN');
    return { contractId: String(contractId), askPrice: ask };
  });
}

function contractIdentifier(value) {
  if (!(typeof value === 'string' || Number.isSafeInteger(value)) ||
      !/^[0-9]{1,30}$/.test(String(value)))
    throw codedError('INVALID_BROKER_CONTRACT_ID');
  return String(value);
}

export async function readRealPortfolio({ account, token, appId, fetchImpl = fetch, Socket }) {
  if (!isDerivAccount(account)) throw codedError('REAL_ACCOUNT_REQUIRED');
  return withRealSocket({ token, account, appId, fetchImpl, Socket }, async socket => {
    const response = await sendAndWait(socket, { portfolio: 1 }, 'portfolio', 1);
    const rows = response?.portfolio?.contracts;
    if (!Array.isArray(rows)) throw codedError('INVALID_PORTFOLIO_RESPONSE');
    const contracts = [];
    let reqId = 2;
    for (const row of rows) {
      const id = contractIdentifier(row.contract_id);
      const detail = await sendAndWait(socket, {
        proposal_open_contract: 1,
        contract_id: Number(id),
      }, 'proposal_open_contract', reqId++);
      const contract = detail.proposal_open_contract;
      const stake = Number(contract.buy_price);
      if (String(contract.contract_id) !== id || contract.is_sold !== 0 ||
          contract.status !== 'open' || !Number.isFinite(Number(contract.profit)) ||
          !Number.isFinite(stake) || stake <= 0)
        throw codedError('UNVERIFIED_OPEN_CONTRACT');
      contracts.push({
        id,
        symbol: typeof contract.underlying_symbol === 'string' ? contract.underlying_symbol : null,
        profit: Number(contract.profit),
        canSell: contract.is_valid_to_sell === 1,
        stake,
      });
    }
    return { accountId: account.account_id, contracts, observedAt: new Date().toISOString() };
  });
}

export async function readRealHistory({ account, token, appId, fetchImpl = fetch, Socket, now = Date.now }) {
  if (!isDerivAccount(account)) throw codedError('REAL_ACCOUNT_REQUIRED');
  return withRealSocket({ token, account, appId, fetchImpl, Socket }, async socket => {
    const observedAt = new Date(now());
    // Tanzania (EAT) is UTC+03:00 year-round.
    const eatOffset = 3 * 3600;
    const epoch = Math.floor(observedAt.getTime() / 1000);
    const start = Math.floor((epoch + eatOffset) / 86400) * 86400 - eatOffset;
    const date = new Date((start + eatOffset) * 1000).toISOString().slice(0, 10);
    async function readPage(params, requestId) {
      const response = await sendAndWait(socket, {
        profit_table: 1, sort: 'DESC', ...params,
      }, 'profit_table', requestId);
      const rows = response?.profit_table?.transactions;
      if (!Array.isArray(rows)) throw codedError('INVALID_HISTORY_RESPONSE');
      return rows.map(row => {
        const id = contractIdentifier(row.transaction_id);
        const buy = Number(row.buy_price);
        const sell = Number(row.sell_price);
        const settledAt = Number(row.sell_time);
        if (row.buy_price == null || row.sell_price == null ||
            !Number.isFinite(buy) || buy < 0 || !Number.isFinite(sell) || sell < 0)
          throw codedError('INVALID_HISTORY_RESPONSE');
        const brokerId = row.contract_id;
        const contractId = typeof brokerId === 'string' || Number.isSafeInteger(brokerId)
          ? String(brokerId) : null;
        return { id, contractId, buy, sell, settledAt };
      });
    }

    const transactions = await readPage({ limit: 25 }, 1);
    let today = null;
    try {
      const daily = new Map(transactions
        .filter(row => row.settledAt >= start && row.settledAt <= epoch)
        .map(row => [row.id, row]));
      const limit = 500;
      if (transactions.some(row => !Number.isSafeInteger(row.settledAt) || row.settledAt <= 0))
        throw codedError('SETTLEMENT_TIME_UNAVAILABLE');
      // Keep the query bounded. Never present a truncated count as a daily total.
      for (let page = 0; page < 8; page++) {
        const rows = await readPage({
          limit, offset: page * limit, date_from: String(start), date_to: String(epoch),
        }, page + 2);
        if (rows.some(row => !Number.isSafeInteger(row.settledAt) || row.settledAt <= 0)) break;
        for (const row of rows) {
          if (row.settledAt >= start && row.settledAt <= epoch) daily.set(row.id, row);
        }
        if (rows.length < limit) {
          const settled = [...daily.values()];
          today = {
            date,
            wins: settled.filter(row => row.sell > row.buy).length,
            losses: settled.filter(row => row.sell < row.buy).length,
            total: settled.length,
          };
          break;
        }
      }
    } catch {
      // The recent log remains available when the daily broker query fails.
    }
    return { accountId: account.account_id, transactions, today, observedAt: observedAt.toISOString() };
  });
}

export async function closeRealContracts({ account, token, appId, contractIds, fetchImpl = fetch, Socket }) {
  if (!isDerivAccount(account) || !Array.isArray(contractIds))
    throw codedError('REAL_ACCOUNT_REQUIRED');
  return withRealSocket({ token, account, appId, fetchImpl, Socket }, async socket => {
    const results = [];
    let reqId = 1;
    for (const value of contractIds) {
      const id = contractIdentifier(value);
      try {
        const response = await sendAndWait(socket, { sell: Number(id), price: 0 }, 'sell', reqId++);
        results.push({ contractId: id, closed: response.sell?.sold_for !== undefined });
      } catch (error) {
        results.push({ contractId: id, closed: false, reason: error.code || 'CLOSE_FAILED' });
      }
    }
    return results;
  });
}
