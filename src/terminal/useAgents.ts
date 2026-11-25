import { useCallback, useEffect, useRef, useState } from "react";
import { terminalAgents, type AgentInfo } from "./api";

/**
 * The known agents and whether each is installed; `null` until `refresh` is
 * first called (nothing is checked on mount). Only the latest call's result
 * is applied, and a failed check keeps the last result.
 */
export function useAgents(): { agents: AgentInfo[] | null; refresh(): void } {
  const [agents, setAgents] = useState<AgentInfo[] | null>(null);
  const latest = useRef(0);

  const refresh = useCallback(() => {
    const call = ++latest.current;
    terminalAgents().then(
      (list) => {
        if (call === latest.current) setAgents(list);
      },
      () => {},
    );
  }, []);

  // Results that arrive after unmount are dropped.
  useEffect(() => {
    const counter = latest;
    return () => {
      counter.current = -1;
    };
  }, []);

  return { agents, refresh };
}
