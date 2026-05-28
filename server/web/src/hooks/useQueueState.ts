import { useState, useEffect, useCallback } from "react";
import { api } from "../api";
import type { QueueFullState } from "../types";

const POLL_INTERVAL = 2500;

export function useQueueState() {
  const [state, setState] = useState<QueueFullState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await api.getQueueState();
      setState(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [refresh]);

  return { state, error, refresh };
}
