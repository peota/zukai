//! Git sync for library folders: a bounded git runner, discovery and errors.

// Later tasks build on these; until they land some items are unused.
#![allow(dead_code, unused_imports)]

mod clone;
mod error;
mod ops;
mod run;
mod status;
#[cfg(test)]
mod testutil;
mod url;

pub use clone::{check_name, clone_into, repo_name};
pub use error::{GitError, GitKind, classify, first_line};
pub use ops::{commit_push, pull, push, setup};
pub use run::{CancelFlag, Done, Git, RunFail, find_git};
pub use status::{FolderGit, Parsed, RepoState, RepoStatus, folder_git, parse_porcelain};
pub use url::check_url;
