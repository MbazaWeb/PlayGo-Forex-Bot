const TOKEN_URL='https://auth.deriv.com/oauth2/token';
const ACCOUNTS_URL='https://api.derivws.com/trading/v1/options/accounts';

function mapAccount(a){
 const id=a.account_id??a.id??a.loginid;
 if(typeof id!=='string'&&typeof id!=='number')throw Error('Account identifier missing');
 return {account_id:String(id),account_type:typeof a.account_type==='string'?a.account_type:null,currency:typeof a.currency==='string'?a.currency:null,balance:typeof a.balance==='number'||typeof a.balance==='string'?a.balance:null};
}

export async function exchangeCode({code,verifier,config,fetcher=fetch}){
 const r=await fetcher(TOKEN_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:config.clientId,code,code_verifier:verifier,redirect_uri:config.redirectUri}),signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('Token exchange failed');
 const body=await r.json();
 if(typeof body.access_token!=='string'||!Number.isFinite(body.expires_in)||body.expires_in<=0)throw Error('Invalid token response');
 return {token:body.access_token,expires:Date.now()+Math.min(body.expires_in,28800)*1000};
}
export async function listAccounts(token,fetcher=fetch,appId){
 const r=await fetcher(ACCOUNTS_URL,{redirect:'error',headers:{...(appId ? {'Deriv-App-ID':appId} : {}),Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});
 if(!r.ok){const e=Error('Deriv account service returned an error');e.status=[401,429].includes(r.status)?r.status:502;throw e;}
 const body=await r.json();
 const rows=Array.isArray(body.data)?body.data:body.data?.accounts??body.accounts;
 if(!Array.isArray(rows))throw Error('Unsupported account response schema');
 return rows.map(mapAccount);
}

export async function createDemoAccount(token,fetcher=fetch,appId){
 const r=await fetcher(ACCOUNTS_URL,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',...(appId ? {'Deriv-App-ID':appId} : {}),Authorization:'Bearer '+token},body:JSON.stringify({currency:'USD',group:'row',account_type:'demo'}),signal:AbortSignal.timeout(15000)});
 if(!r.ok){const e=Error('Deriv demo account service returned an error');e.status=r.status;throw e;}
 const body=await r.json();
 const row=Array.isArray(body.data)?body.data[0]:body.data?.account??body.data;
 if(!row||typeof row!=='object')throw Error('Unsupported demo account response schema');
 const account=mapAccount(row);
 if(account.account_type!=='demo')throw Error('Deriv returned a non-demo account');
 return {account,created:r.status===201};
}
