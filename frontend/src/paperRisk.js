export const PAPER_LIMITS=Object.freeze({maxOrderNotional:1000,maxTotalNotional:3000,maxOpenPositions:5,maxDailyRealizedLoss:200});
export function paperRisk(ledger,order,now=new Date()){
 const {price,units}=order;
 if(ledger.halted)return 'Paper trading paused by emergency stop';
 if(!Number.isFinite(price)||price<=0||!Number.isSafeInteger(units)||units<=0)return 'Enter a positive price and whole-number units';
 const notional=price*units;
 if(!Number.isFinite(notional))return 'Invalid notional';
 if(notional>PAPER_LIMITS.maxOrderNotional)return 'Order exceeds $1,000 notional limit';
 if(notional>ledger.cash)return 'Insufficient paper cash';
 if(ledger.positions.length>=PAPER_LIMITS.maxOpenPositions)return 'Maximum five open positions';
 const exposure=ledger.positions.reduce((sum,x)=>sum+x.units*x.entry,0);
 if(exposure+notional>PAPER_LIMITS.maxTotalNotional)return 'Total paper exposure exceeds $3,000';
 const today=now.toISOString().slice(0,10);
 const realized=ledger.history.filter(x=>typeof x.closedAt==='string'&&x.closedAt.slice(0,10)===today).reduce((sum,x)=>sum+(Number.isFinite(x.pnl)?x.pnl:0),0);
 if(realized<=-PAPER_LIMITS.maxDailyRealizedLoss)return 'Daily realized loss limit reached (UTC)';
 return null;
}
