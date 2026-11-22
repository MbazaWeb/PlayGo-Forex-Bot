export async function strategyPassReal() {
  return {status:403,body:{error:'Real-money strategies are unavailable.'}};
}