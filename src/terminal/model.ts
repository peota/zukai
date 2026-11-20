/** One terminal in the panel. */
export interface TermInfo {
  id: number;
  /** The folder the terminal was opened in. */
  cwd: string;
  /** `undefined` while running; `null` once exited with no code. */
  exited: number | null | undefined;
}

export interface TermState {
  terms: TermInfo[];
  activeId: number | null;
  /** Whether the panel is visible. Hiding never ends a terminal. */
  shown: boolean;
}

export type TermAction =
  | { type: "opened"; id: number; cwd: string }
  | { type: "killed"; id: number }
  | { type: "exited"; id: number; code: number | null }
  | { type: "activate"; id: number }
  | { type: "show" }
  | { type: "hide" };

export const initialTermState: TermState = {
  terms: [],
  activeId: null,
  shown: false,
};

export function termReducer(s: TermState, a: TermAction): TermState {
  switch (a.type) {
    case "opened":
      return {
        terms: [...s.terms, { id: a.id, cwd: a.cwd, exited: undefined }],
        activeId: a.id,
        shown: true,
      };
    case "killed": {
      const i = s.terms.findIndex((t) => t.id === a.id);
      if (i < 0) return s;
      const terms = s.terms.filter((t) => t.id !== a.id);
      if (terms.length === 0) return { terms, activeId: null, shown: false };
      if (s.activeId !== a.id) return { ...s, terms };
      // The neighbour on the right moved into slot `i`; else take the left.
      const next = terms[i] ?? terms[i - 1];
      return { ...s, terms, activeId: next.id };
    }
    case "exited":
      return {
        ...s,
        terms: s.terms.map((t) =>
          t.id === a.id ? { ...t, exited: a.code } : t,
        ),
      };
    case "activate":
      return s.terms.some((t) => t.id === a.id) ? { ...s, activeId: a.id } : s;
    case "show":
      return { ...s, shown: true };
    case "hide":
      return { ...s, shown: false };
  }
}
