import { useState, useEffect, useCallback } from "react";
import type { ApiClient } from "../api";
import type { QueueFullState } from "../types";

const POLL_INTERVAL = 2500;

export function useQueueState(apiInstance: ApiClient | null) {
  const [state, setState] = useState<QueueFullState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!apiInstance) return;
    try {
      const data = await apiInstance.getQueueState();
      setState(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [apiInstance]);

  useEffect(() => {
    if (!apiInstance) return;
    refresh();
    const id = setInterval(refresh, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [refresh, apiInstance]);

  return { state, error, refresh };
}
