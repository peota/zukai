//! Git sync for library folders: a bounded git runner, discovery, errors,
//! and the Tauri commands behind the "Git sync" setting.

mod branches;
mod changes;
mod clone;
pub mod commands;
mod error;
mod head_file;
mod ops;
mod run;
pub mod state;
mod status;
#[cfg(test)]
mod testutil;
mod url;

pub use branches::{Branches, branches, create_branch, switch};
pub use changes::{Change, changes};
pub use clone::{check_name, clone_into};
pub use error::{GitError, GitKind};
pub use head_file::{HeadFile, head_file};
pub use run::{CancelFlag, Git, find_git};
pub use status::{FolderGit, RepoState, RepoStatus, folder_git};
