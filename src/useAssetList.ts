import { useCallback, useEffect, useRef, useState } from 'react';
import { type ApiClient, errorMessage } from './api';
import type { AssetList, ListOptions } from './types';

export function useAssetList(api: ApiClient, options: ListOptions) {
  const [data, setData] = useState<AssetList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const { q, sort, order } = options;
  const refresh = useCallback(async () => {
    const current = ++sequence.current;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setLoading(true);
    setError('');
    try {
      const result = await api.assets({ q, sort, order }, request.signal);
      if (!request.signal.aborted && current === sequence.current) setData(result);
    } catch (err) {
      if (!request.signal.aborted && current === sequence.current) setError(errorMessage(err));
    } finally {
      if (!request.signal.aborted && current === sequence.current) setLoading(false);
    }
  }, [api, q, sort, order]);
  useEffect(() => {
    void refresh();
    return () => controller.current?.abort();
  }, [refresh]);
  return { data, loading, error, refresh };
}
