//! Fuzzy matching for Quick open (Mod+P): the query's characters must appear
//! in order in a file's path relative to its tree, ignoring case. Matches at
//! word starts, in a row and in the file name score higher, so `mdprev`
//! finds `src/markdown/MarkdownPreview.tsx` before `md/prev.txt` deep down.

/// A score and the matched character positions (in `char`s, not bytes).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Match {
    pub score: i32,
    pub positions: Vec<u32>,
}

const NEG: i32 = i32::MIN / 4;
/// Each matched character after another.
const CONSECUTIVE: i32 = 6;
/// Each character skipped between two matches, or after the last one.
const GAP: i32 = 1;
/// All matches inside the file name.
const IN_NAME: i32 = 20;
/// Paths longer than this (in chars) or queries longer than `MAX_QUERY`
/// fall back to a plain left-to-right match.
const MAX_TARGET: usize = 512;
const MAX_QUERY: usize = 64;

/// Lowercase, `\` read as `/`: what both sides are compared as.
fn fold(c: char) -> char {
    if c == '\\' {
        '/'
    } else {
        c.to_lowercase().next().unwrap_or(c)
    }
}

/// The query as matched: folded, with whitespace dropped.
pub fn prepare(query: &str) -> Vec<char> {
    query
        .chars()
        .filter(|c| !c.is_whitespace())
        .map(fold)
        .collect()
}

/// How good a place `j` is for a match to start a run.
fn bonus(orig: &[char], j: usize, name_start: usize) -> i32 {
    let here = if j == name_start {
        12
    } else {
        let prev = if j == 0 { '/' } else { orig[j - 1] };
        let cur = orig[j];
        if prev == '/' || prev == '\\' {
            8
        } else if matches!(prev, '_' | '-' | '.' | ' ')
            || (prev.is_lowercase() && cur.is_uppercase())
        {
            6
        } else if !prev.is_alphanumeric() && cur.is_alphanumeric() {
            4
        } else {
            0
        }
    };
    // A match in the file name beats one in a folder name.
    here + if j >= name_start { 2 } else { 0 }
}

/// Scratch space reused across candidates.
#[derive(Default)]
pub struct Scorer {
    orig: Vec<char>,
    low: Vec<char>,
    bonus: Vec<i32>,
    /// Best score with query[i] matched exactly at target[j].
    d: Vec<i32>,
    /// Best score with query[..=i] matched somewhere in target[..=j].
    m: Vec<i32>,
}

impl Scorer {
    /// `target` against a `prepare`d `query`; `None` if it doesn't match
    /// (and for an empty query).
    pub fn score(&mut self, target: &str, query: &[char]) -> Option<Match> {
        if query.is_empty() {
            return None;
        }
        self.orig.clear();
        self.orig.extend(target.chars());
        self.low.clear();
        self.low.extend(self.orig.iter().map(|&c| fold(c)));
        let (low, orig) = (&self.low, &self.orig);

        // Cheap reject: not a subsequence.
        let mut qi = 0;
        for &c in low {
            if c == query[qi] {
                qi += 1;
                if qi == query.len() {
                    break;
                }
            }
        }
        if qi < query.len() {
            return None;
        }

        let n = low.len();
        let m = query.len();
        let name_start = low.iter().rposition(|&c| c == '/').map_or(0, |i| i + 1);
        self.bonus.clear();
        self.bonus
            .extend((0..n).map(|j| bonus(orig, j, name_start)));

        let positions = if n > MAX_TARGET || m > MAX_QUERY {
            greedy(low, query)
        } else {
            self.align(query)
        };
        let mut score = if n > MAX_TARGET || m > MAX_QUERY {
            positions
                .iter()
                .map(|&p| self.bonus[p as usize])
                .sum::<i32>()
                - n as i32
        } else {
            self.m[(m - 1) * n + n - 1]
        };
        if positions[0] as usize >= name_start {
            score += IN_NAME;
        }
        // Shorter paths first among equals.
        score -= n as i32 / 8;
        Some(Match { score, positions })
    }

    /// The best alignment (a Smith-Waterman-style DP, as in fzy) and its
    /// positions.
    fn align(&mut self, query: &[char]) -> Vec<u32> {
        let n = self.low.len();
        let m = query.len();
        self.d.clear();
        self.d.resize(m * n, NEG);
        self.m.clear();
        self.m.resize(m * n, NEG);
        for (i, &q) in query.iter().enumerate() {
            let mut best = NEG;
            for j in 0..n {
                let mut dij = NEG;
                if self.low[j] == q {
                    let b = self.bonus[j];
                    if i == 0 {
                        dij = b;
                    } else if j > 0 {
                        let after_gap = self.m[(i - 1) * n + j - 1];
                        let in_row = self.d[(i - 1) * n + j - 1];
                        if after_gap > NEG {
                            dij = after_gap + b;
                        }
                        if in_row > NEG {
                            dij = dij.max(in_row + CONSECUTIVE.max(b));
                        }
                    }
                }
                self.d[i * n + j] = dij;
                best = dij.max(if best > NEG { best - GAP } else { NEG });
                self.m[i * n + j] = best;
            }
        }

        // Walk back from the end.
        let mut positions = vec![0u32; m];
        let mut i = m;
        let mut j = n;
        let mut forced = false;
        while i > 0 && j > 0 {
            let (iu, ju) = (i - 1, j - 1);
            let dij = self.d[iu * n + ju];
            if dij > NEG && (forced || dij == self.m[iu * n + ju]) {
                positions[iu] = ju as u32;
                forced = iu > 0 && ju > 0 && {
                    let in_row = self.d[(iu - 1) * n + ju - 1];
                    in_row > NEG && in_row + CONSECUTIVE.max(self.bonus[ju]) == dij
                };
                i -= 1;
            }
            j -= 1;
        }
        positions
    }
}

/// Each query char at its first place after the last.
fn greedy(low: &[char], query: &[char]) -> Vec<u32> {
    let mut out = Vec::with_capacity(query.len());
    let mut qi = 0;
    for (j, &c) in low.iter().enumerate() {
        if qi < query.len() && c == query[qi] {
            out.push(j as u32);
            qi += 1;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn score(target: &str, q: &str) -> Option<Match> {
        Scorer::default().score(target, &prepare(q))
    }

    /// The targets that match, best first.
    fn rank<'a>(targets: &[&'a str], q: &str) -> Vec<&'a str> {
        let mut s = Scorer::default();
        let query = prepare(q);
        let mut hits: Vec<(i32, &str)> = targets
            .iter()
            .filter_map(|t| s.score(t, &query).map(|m| (m.score, *t)))
            .collect();
        hits.sort_by(|a, b| b.0.cmp(&a.0));
        hits.into_iter().map(|h| h.1).collect()
    }

    #[test]
    fn matches_a_subsequence_ignoring_case() {
        assert!(score("src/MarkdownPreview.tsx", "mdprev").is_some());
        assert!(score("src/MarkdownPreview.tsx", "MDPREV").is_some());
        assert!(score("src/MarkdownPreview.tsx", "vdm").is_none());
        assert!(score("anything", "").is_none());
    }

    #[test]
    fn spaces_are_ignored_and_backslash_is_a_slash() {
        assert!(score("notes/todo.md", "notes todo").is_some());
        assert!(score("notes/todo.md", "notes\\todo").is_some());
    }

    #[test]
    fn positions_point_at_the_best_run() {
        let m = score("a/readme.md", "read").unwrap();
        assert_eq!(m.positions, [2, 3, 4, 5]);
        // The file name's run, not the scattered letters in the folder.
        let m = score("my-docs/docs.md", "docs").unwrap();
        assert_eq!(m.positions, [8, 9, 10, 11]);
    }

    #[test]
    fn positions_are_chars_not_bytes() {
        let m = score("über/naïve.md", "NAÏVE").unwrap();
        assert_eq!(m.positions, [5, 6, 7, 8, 9]);
    }

    #[test]
    fn prefers_file_name_word_starts_and_short_paths() {
        assert_eq!(
            rank(
                &[
                    "deep/a/b/c/amdxpxrxexvx.txt",
                    "src/markdown/MarkdownPreview.tsx",
                    "mdprev/other.txt",
                ],
                "mdprev",
            )[0],
            "src/markdown/MarkdownPreview.tsx"
        );
        assert_eq!(
            rank(&["projects/old/todo.md", "todo.md"], "todo"),
            ["todo.md", "projects/old/todo.md"]
        );
        assert_eq!(
            rank(&["tools/notes.md", "notes/tools.md"], "tools"),
            ["notes/tools.md", "tools/notes.md"]
        );
    }

    #[test]
    fn a_path_query_matches_across_folders() {
        assert_eq!(
            rank(&["work/plan.md", "home/plan.md"], "work/plan"),
            ["work/plan.md"]
        );
    }

    #[test]
    fn very_long_paths_still_match() {
        let long = format!("{}/target.md", "x".repeat(600));
        let m = score(&long, "target").unwrap();
        assert_eq!(m.positions.len(), 6);
        assert_eq!(m.positions[0] as usize, 601);
    }
}
