import { useEffect, useState } from "react";
import type { ThemePref } from "../model/settings";

const QUERY = "(prefers-color-scheme: dark)";

/** The OS light or dark mode right now. */
export const systemScheme = (): "light" | "dark" =>
  typeof window.matchMedia === "function" && window.matchMedia(QUERY).matches
    ? "dark"
    : "light";

/**
 * The scheme to show for `pref`: Light or Dark as chosen, or the OS mode
 * (live) for System. The app puts it on <html data-theme>, which the CSS
 * palette follows.
 */
export function useColorScheme(pref: ThemePref = "system"): "light" | "dark" {
  const [system, setSystem] = useState(systemScheme);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(QUERY);
    const onChange = () => setSystem(mq.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return pref === "system" ? system : pref;
}
