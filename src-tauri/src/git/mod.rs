//! Git sync for library folders: a bounded git runner, discovery and errors.

// Later tasks build on these; until they land some items are unused.
#![allow(dead_code, unused_imports)]

mod error;
mod run;

pub use error::{GitError, GitKind, classify, first_line};
pub use run::{Done, Git, RunFail, find_git};
