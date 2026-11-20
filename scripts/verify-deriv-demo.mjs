import {listAccounts} from '../apps/api/src/providers/deriv.js';
import {readDemoPortfolio,readDemoHistory,readMarketQuote} from '../apps/web/api/trading/demo-portfolio.js';

const required=['DERIV_CLIENT_ID','DERIV_DEMO_TOKEN','DERIV_DEMO_ACCOUNT_ID'];
const missing=required.filter(name=>!process.env[name]?.trim());
if(missing.length){
  console.error('Missing server environment variables: '+missing.join(', '));
  process.exitCode=1;
} else {
  const {DERIV_CLIENT_ID:appId,DERIV_DEMO_TOKEN:token,DERIV_DEMO_ACCOUNT_ID:accountId}=process.env;
  let stage='authenticated account lookup';
  try {
    const accounts=await listAccounts(token,fetch,appId);
    const matches=accounts.filter(row=>row.account_id===accountId);
    if(matches.length!==1 || matches[0].account_type!=='demo')throw Error();
    console.log('PASS authenticated demo identity');
    const context={accounts,accountId,appId,token};
    stage='demo portfolio';
    const portfolio=await readDemoPortfolio(context);
    console.log('PASS portfolio, open contracts:',portfolio.contracts.length);
    stage='demo trade history';
    const history=await readDemoHistory(context);
    console.log('PASS history, returned transactions:',history.transactions.length);
    stage='EUR/USD tick and proposal (requires an available market)';
    await readMarketQuote(context,{symbol:'frxEURUSD',contractType:'CALL',duration:5,durationUnit:'m',stake:1});
    console.log('PASS EUR/USD tick and read-only proposal');
  } catch {
    console.error('Verification incomplete at '+stage+'.');
    process.exitCode=1;
  }
}
