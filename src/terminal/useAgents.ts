import { useCallback, useEffect, useRef, useState } from "react";
import { terminalAgents, type AgentInfo } from "./api";

/**
 * The known agents and whether each is installed; `null` until the first
 * check. `refresh` checks again: only the latest call's result is applied,
 * and a failed check keeps the last result.
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

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { agents, refresh };
}
