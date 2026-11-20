import {getDemoWebSocketUrl,demoProposal} from './deriv-demo.js';

async function readDemo({token, accountId, accounts, appId, fetchImpl, Socket = WebSocket}, request, extract) {
  const matches = accounts.filter(a => a.account_id === accountId);
  if (matches.length !== 1 || matches[0].account_type !== 'demo') throw Error('DEMO_ACCOUNT_REQUIRED');
  async function attempt() {
    const url = await getDemoWebSocketUrl({token, accountId, appId, fetchImpl});
    return new Promise((resolve, reject) => {
      const socket = new Socket(url);
      let done = false;
      function finish(error, value) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        socket.close();
        if (error) reject(Error(error));
        else resolve(value);
      }
      const timer = setTimeout(() => finish('BROKER_TIMEOUT'), 8000);
      socket.onopen = () => {
        try { socket.send(JSON.stringify({...request, req_id:1})); }
        catch { finish('BROKER_DISCONNECTED'); }
      };
      socket.onerror = socket.onclose = () => finish('BROKER_DISCONNECTED');
      socket.onmessage = ({data}) => {
        try {
          const reply = JSON.parse(data);
          if (reply.req_id !== 1) return;
          if (reply.error?.code === 'RateLimit') return finish('BROKER_RATE_LIMIT');
          if (reply.error || reply.msg_type !== (request.ticks ? 'tick' : Object.keys(request)[0])) throw Error();
          finish(null, extract(reply));
        } catch { finish('INVALID_BROKER_RESPONSE'); }
      };
    });
  }
  try { return await attempt(); }
  catch (error) {
    if (!['BROKER_TIMEOUT','BROKER_DISCONNECTED'].includes(error.message)) throw error;
    return attempt(); // Read operations only. Acquire a new OTP after disconnect.
  }
}

function identifier(value) {
  if (!(typeof value === 'string' || Number.isSafeInteger(value)) || !/^[1-9][0-9]*$/.test(String(value)))
    throw Error('INVALID_IDENTIFIER');
  return String(value);
}

export function readDemoPortfolio(context) {
  return readDemo(context, {portfolio:1}, reply => {
    const contracts = reply.portfolio.contracts.map(row => ({
      id:identifier(row.contract_id), symbol:typeof row.underlying_symbol === 'string' ? row.underlying_symbol : null
    }));
    return {accountId:context.accountId, contracts, observedAt:new Date().toISOString(), execution:false};
  });
}

function money(value) {
  if (!['string','number'].includes(typeof value) || !/^\d+(\.\d+)?$/.test(String(value)) || !Number.isFinite(Number(value)))
    throw Error('INVALID_AMOUNT');
  return String(value);
}

export function readDemoHistory(context) {
  return readDemo(context, {profit_table:1,limit:25,sort:'DESC'}, reply => ({
    accountId:context.accountId,
    transactions:reply.profit_table.transactions.map(row => ({
      id:identifier(row.transaction_id),buy:money(row.buy_price),sell:money(row.sell_price)
    })),
    observedAt:new Date().toISOString()
  }));
}

export function readContractEvidence(context, intent) {
  if (intent.account_mode !== 'demo' || context.accountId !== intent.account_id || !intent.broker_contract_id)
    throw Error('DURABLE_CONTRACT_BINDING_REQUIRED');
  const contractId = identifier(intent.broker_contract_id);
  if (!Number.isSafeInteger(Number(contractId))) throw Error('UNSUPPORTED_CONTRACT_ID');
  return readDemo(context, {proposal_open_contract:1,contract_id:Number(contractId)}, reply => {
    const row = reply.proposal_open_contract;
    if (identifier(row.contract_id) !== contractId || row.underlying_symbol !== intent.symbol ||
        row.contract_type !== intent.contract_type) throw Error('CONTRACT_MISMATCH');
    const closed = ['won','lost','sold'].includes(row.status) && row.is_sold === 1;
    const open = row.status === 'open' && row.is_sold === 0;
    return {source:'authenticated_deriv_server',account_mode:'demo',account_id:context.accountId,
      verified:true,contract_id:contractId,is_open:open,is_sold:closed,
      settlement_verified:closed && Number.isSafeInteger(row.sell_time) && row.sell_time>0,
      settlement:closed ? {cost:money(row.buy_price),proceeds:money(row.sell_price),soldAt:row.sell_time} : null};
  });
}

export async function readMarketQuote(context, intent) {
  const account = context.accounts.find(a => a.account_id === context.accountId && a.account_type === 'demo');
  if (!account || !/^[A-Z]{3}$/.test(account.currency) || !/^[A-Za-z0-9_]{2,30}$/.test(intent.symbol) ||
      !['CALL','PUT'].includes(intent.contractType) || !Number.isSafeInteger(intent.duration) ||
      intent.duration < 1 || intent.duration > 60 || intent.durationUnit !== 'm' ||
      !Number.isFinite(intent.stake) || intent.stake <= 0 || intent.stake > 1) throw Error('INVALID_QUOTE');
  await readDemo(context,{contracts_for:intent.symbol},reply=>{
    if (!reply.contracts_for.available.some(c=>c.contract_type === intent.contractType))
      throw Error('CONTRACT_UNAVAILABLE');
  });
  const tick = await readDemo(context,{ticks:intent.symbol,subscribe:1},reply=>{
    if (reply.tick.symbol !== intent.symbol || !Number.isSafeInteger(reply.tick.epoch)) throw Error('INVALID_TICK');
    return {epoch:reply.tick.epoch,price:money(reply.tick.quote)};
  });
  const proposal = await readDemo(context,{...demoProposal(intent,account.currency),subscribe:1},reply=>({
    ask:money(reply.proposal.ask_price),payout:money(reply.proposal.payout)
  }));
  return {symbol:intent.symbol,currency:account.currency,tick,proposal,execution:false};
}
