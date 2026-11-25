import { brokerRequest } from './brokerRequest.js';
import { useEffect, useState } from 'react';

export default function useStakeLimits(accountRef) {
  const [state, setState] = useState({ limits: null, error: false });

  useEffect(() => {
    if (!accountRef) {
      setState({ limits: null, error: false });
      return undefined;
    }
    const controller = new AbortController();
    let timer;
    let refreshing = false;
    let pending = false;
    async function refresh() {
      if (refreshing) {
        pending = true;
        return;
      }
      refreshing = true;
      try {
        const response = await brokerRequest('/api/agent/limits', {
          signal: controller.signal,
          cache: 'no-store',
        });
        const body = await response.json();
        if (
          !response.ok ||
          body.accountRef !== accountRef ||
          !Number.isFinite(body.stake) ||
          body.stake <= 0 ||
          !Number.isFinite(body.maxStake) ||
          body.maxStake <= 0
        )
          throw new Error(body.error || 'Stake limits unavailable.');
        if (!controller.signal.aborted) setState({ limits: body, error: false });
      } catch {
        if (!controller.signal.aborted) setState({ limits: null, error: true });
      } finally {
        refreshing = false;
        if (!controller.signal.aborted) {
          timer = setTimeout(refresh, pending ? 0 : 15_000);
          pending = false;
        }
      }
    }
    function onUpdate(event) {
      if (event.detail === accountRef) void refresh();
    }
    window.addEventListener('playgo:position', onUpdate);
    window.addEventListener('playgo:settlement', onUpdate);
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
      window.removeEventListener('playgo:position', onUpdate);
      window.removeEventListener('playgo:settlement', onUpdate);
    };
  }, [accountRef]);

  return state;
}
