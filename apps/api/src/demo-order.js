import {listAccounts} from './providers/deriv.js';
import {getDemoWebSocketUrl,demoProposal} from '../../web/server/trading/deriv-demo.js';
import {atomicDemoTransition} from '../../web/server/trading/atomic-worker.js';
import {reserveDemoIntent} from '../../web/server/trading/reservation.js';

import {brokerDemoState} from './broker-demo-state.js';
import {readDemoPortfolio} from '../../web/server/trading/demo-portfolio.js';

function waitFor(socket, event, action, accept) {
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>finish(Error('DEMO_SOCKET_TIMEOUT')),8000);
    function finish(error,value) {
      clearTimeout(timer);
      socket.removeEventListener(event,receive);
      socket.removeEventListener('close',disconnect);
      socket.removeEventListener('error',disconnect);
      if (error) reject(error); else resolve(value);
    }
    function disconnect(){finish(Error('DEMO_DISCONNECTED'));}
    function receive(message){
      try {
        const value=accept(message);
        if(value!==undefined) finish(null,value);
      } catch {finish(Error('INVALID_DEMO_RESPONSE'));}
    }
    socket.addEventListener(event,receive);
    socket.addEventListener('close',disconnect);
    socket.addEventListener('error',disconnect);
    try {action();} catch {disconnect();}
  });
}

function exchange(socket,request,type){
  return waitFor(socket,'message',()=>socket.send(JSON.stringify(request)),message=>{
    const data=JSON.parse(message.data);
    if(data.req_id!==request.req_id) return;
    if(data.error || data.msg_type!==type || !data[type]) throw Error();
    return data[type];
  });
}

export async function executeDemoOrder(input, fixture) {
  const env=input.env ?? process.env;
  if(env.LIVE_TRADING_ENABLED!=='false' || env.PLAYGO_DEMO_EXECUTION_ENABLED!=='true')
    throw Error('DEMO_SUBMISSION_DISABLED');
  const test=env.PLAYGO_ENV==='test' && fixture?.Socket && fixture.Socket!==globalThis.WebSocket &&
    typeof fixture.fetchImpl==='function' && fixture.fetchImpl!==globalThis.fetch;
  if(!test && (env.PLAYGO_ENV==='test' || !env.PLAYGO_BROKER_DEMO_ACCOUNT || env.PLAYGO_BROKER_DEMO_ACCOUNT!==env.DERIV_DEMO_ACCOUNT_ID)) throw Error('DEMO_SUBMISSION_DISABLED');
  const {Socket=WebSocket,fetchImpl=fetch}=test?fixture:{};
  const {DERIV_DEMO_ACCOUNT_ID:id,DERIV_DEMO_TOKEN:token,DERIV_CLIENT_ID:appId}=env;
  if(!id || !token || !appId) throw Error('DEMO_AUTH_REQUIRED');
  const rows=(await listAccounts(token,fetchImpl,appId)).filter(a=>a.account_id===id);
  if(rows.length!==1 || rows[0].account_type!=='demo') throw Error('DEMO_ACCOUNT_REQUIRED');
  const account={id,type:'demo',currency:rows[0].currency,balance:Number(rows[0].balance)};
  const intent=Object.freeze({...input.intent});
  const reserve=test && fixture.reserve || reserveDemoIntent;
  const transition=test && fixture.transition || atomicDemoTransition;
  let state=input.state;
  if(!test){
    if(!input.strategyId?.startsWith('deriv-'))throw Error('DEMO_STRATEGY_REQUIRED');
    const risk=await brokerDemoState(env,id,fetchImpl);
    const portfolio=await readDemoPortfolio({accounts:rows,accountId:id,token,appId,fetchImpl,Socket});
    state={...risk,openContracts:portfolio.contracts.length};
  }
  const reservation=await reserve({...input,intent,state,env,account,fetchImpl});
  if(!reservation.accepted) return reservation;
  const change=(event,brokerContractId)=>transition({intentId:reservation.reservationId,event,brokerContractId,env,fetchImpl});
  let socket,claimStarted=false,claimed=false,contractId;
  try {
    socket=new Socket(await getDemoWebSocketUrl({token,accountId:id,appId,fetchImpl}));
    await waitFor(socket,'open',()=>{},()=>true);
    const contracts=await exchange(socket,{contracts_for:intent.symbol,req_id:1},'contracts_for');
    if(!contracts.available.some(c=>c.contract_type===intent.contractType)) throw Error('CONTRACT_UNAVAILABLE');
    const proposal=await exchange(socket,{...demoProposal(intent,account.currency),subscribe:1,req_id:2},'proposal');
    if(typeof proposal.id!=='string' || !proposal.id.trim() || !/^[0-9]+(\.[0-9]+)?$/.test(String(proposal.ask_price)) ||
       Number(proposal.ask_price)!==intent.stake) throw Error('PRICE_MISMATCH');
    claimStarted=true;
    await change('submit');
    claimed=true;
    const buy=await exchange(socket,{buy:proposal.id,price:intent.stake,req_id:3},'buy');
    if(!(typeof buy.contract_id==='string' || Number.isSafeInteger(buy.contract_id)) ||
       !/^[1-9][0-9]{0,29}$/.test(String(buy.contract_id)) || Number(buy.buy_price)!==intent.stake) throw Error('INVALID_PURCHASE');
    contractId=String(buy.contract_id);
  } catch(error) {
    if(!claimStarted) return change('cancel');
    if(claimed) return change('uncertainty');
    throw error;
  } finally {socket?.close();}
  return change('confirm',contractId);
}
