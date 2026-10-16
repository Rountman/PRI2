import { useCallback, useEffect, useRef, useState } from 'react';
import { api, AuthError, type StateResponse } from './api.ts';

export type Live = {
  state: StateResponse | null;
  online: boolean;
  lastOk: Date | null;
  needPin: boolean;
  refresh: () => Promise<void>;
  error: string | null;
};

/** Server state + SSE change notifications with exponential-backoff reconnect. */
export function useLiveState(): Live {
  const [state, setState] = useState<StateResponse | null>(null);
  const [online, setOnline] = useState(false);
  const [lastOk, setLastOk] = useState<Date | null>(null);
  const [needPin, setNeedPin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const version = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const s = await api.state();
      version.current = s.version;
      setState(s);
      setLastOk(new Date());
      setNeedPin(false);
      setError(null);
    } catch (e) {
      if (e instanceof AuthError) setNeedPin(true);
      else setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    let es: EventSource | null = null;
    let retry = 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const connect = () => {
      if (closed) return;
      es = new EventSource('/api/events');
      es.addEventListener('state', (ev) => {
        retry = 1000;
        setOnline(true);
        if (Number((ev as MessageEvent).data) !== version.current) void refresh();
      });
      es.addEventListener('ping', () => {
        setOnline(true);
        setLastOk(new Date());
      });
      es.onerror = () => {
        es?.close();
        setOnline(false);
        timer = setTimeout(connect, retry);
        retry = Math.min(retry * 2, 30_000);
        void api.auth().then((a) => a.required && !a.ok && setNeedPin(true)).catch(() => {});
      };
    };
    void refresh().then(connect);
    return () => {
      closed = true;
      es?.close();
      if (timer) clearTimeout(timer);
    };
  }, [refresh]);

  return { state, online, lastOk, needPin, refresh, error };
}
