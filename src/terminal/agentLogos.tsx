/**
 * The agents' marks in the New terminal menu. Paths are from Simple Icons
 * 16.38.1 (CC0-1.0; the marks themselves belong to their owners). Codex has
 * no mark there, so it keeps a neutral letter.
 */
const PATHS: Record<string, string> = {
  "claude-code":
    "M21 10.5h3v3h-3v3h-1.5v3H18v-3h-1.5v3H15v-3H9v3H7.5v-3H6v3H4.5v-3H3v-3H0v-3h3v-6h18Zm-15 0h1.5v-3H6Zm10.5 0H18v-3h-1.5z",
  gemini:
    "M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81",
  opencode: "M22 24H2V0h20zM17 4.8H7v14.4h10z",
  cursor:
    "M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23",
};

/** Brand colour where it reads on every theme; the rest follow the text. */
const COLORS: Record<string, string> = { "claude-code": "#D97757" };

/** An agent's mark, 16 px, dimmed with its row when `dim`. */
export function AgentLogo({
  id,
  name,
  dim = false,
}: {
  id: string;
  name: string;
  dim?: boolean;
}) {
  const d = PATHS[id];
  const tone = dim ? "opacity-45" : "";
  if (!d) {
    return (
      <span
        aria-hidden="true"
        data-agent-logo={id}
        className={
          "flex h-4 w-4 items-center justify-center rounded-[4px] border border-hairline text-ui-xs leading-none text-faint " +
          tone
        }
      >
        {name.charAt(0)}
      </span>
    );
  }
  return (
    <svg
      aria-hidden="true"
      data-agent-logo={id}
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill={COLORS[id] ?? "currentColor"}
      className={"block " + tone}
    >
      <path d={d} />
    </svg>
  );
}
