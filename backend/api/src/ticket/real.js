export async function executeRealOrder() {
  return {status:403,body:{error:'Real-money trading is unavailable.'}};
}