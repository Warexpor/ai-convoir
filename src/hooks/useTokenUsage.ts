import { useEffect, useState } from "react";
import { totalTokenUsage, type InnerState, type Message } from "../types";

/** Debounce token estimates while a turn is streaming so App does not walk the transcript every chunk. */
export function useTokenUsage(
  messages: Message[],
  config: InnerState | null,
): { used: number; capacity: number } {
  const [stats, setStats] = useState(() => totalTokenUsage(messages, config));
  const streaming = messages.some((m) => m.streaming);

  useEffect(() => {
    if (!streaming) {
      setStats(totalTokenUsage(messages, config));
      return;
    }
    const id = window.setTimeout(() => {
      setStats(totalTokenUsage(messages, config));
    }, 280);
    return () => window.clearTimeout(id);
  }, [messages, config, streaming]);

  return stats;
}
