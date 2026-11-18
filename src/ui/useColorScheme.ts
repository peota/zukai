import { useEffect, useState } from "react";

const QUERY = "(prefers-color-scheme: dark)";

const current = (): "light" | "dark" =>
  typeof window.matchMedia === "function" && window.matchMedia(QUERY).matches
    ? "dark"
    : "light";

/** The OS light or dark mode, live (the app's CSS follows the same query). */
export function useColorScheme(): "light" | "dark" {
  const [scheme, setScheme] = useState(current);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(QUERY);
    const onChange = () => setScheme(mq.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return scheme;
}
