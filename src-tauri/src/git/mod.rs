//! Git sync for library folders: a bounded git runner, discovery and errors.

// Later tasks build on these; until they land some items are unused.
#![allow(dead_code, unused_imports)]

mod error;
mod run;
mod status;
#[cfg(test)]
mod testutil;

pub use error::{GitError, GitKind, classify, first_line};
pub use run::{Done, Git, RunFail, find_git};
pub use status::{FolderGit, Parsed, RepoState, RepoStatus, folder_git, parse_porcelain};
