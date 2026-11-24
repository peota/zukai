//! What the git commands share: the on/off switch, the discovered git,
//! per-folder busy locks, picked clone parents and running clones' cancels.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use super::{CancelFlag, Git, GitError, GitKind, find_git};

#[derive(Default)]
pub struct GitState {
    /// Off until the frontend says the "Git sync" setting is on.
    pub enabled: AtomicBool,
    /// `None` until discovery has run; then what it found.
    pub git: Mutex<Option<Option<Git>>>,
    /// Keys (`grants::key`) of the folders a command is running on.
    pub busy: Mutex<HashSet<String>>,
    /// Clone parents picked in the dialog, by token.
    pub picks: Mutex<HashMap<String, PathBuf>>,
    /// Running clones' cancel flags, by the UI's operation id.
    pub cancels: Mutex<HashMap<String, CancelFlag>>,
    next_pick: AtomicU64,
}

/// Holds a folder's busy lock; releases it on drop.
pub struct BusyGuard<'a> {
    state: &'a GitState,
    key: String,
}

impl Drop for BusyGuard<'_> {
    fn drop(&mut self) {
        lock(&self.state.busy).remove(&self.key);
    }
}

/// Keeps a cancel flag registered under an operation id; removes it on drop.
pub struct CancelReg<'a> {
    state: &'a GitState,
    id: String,
    pub flag: CancelFlag,
}

impl Drop for CancelReg<'_> {
    fn drop(&mut self) {
        let mut cancels = lock(&self.state.cancels);
        // Only our own: a later operation may have reused the id.
        if cancels
            .get(&self.id)
            .is_some_and(|f| Arc::ptr_eq(f, &self.flag))
        {
            cancels.remove(&self.id);
        }
    }
}

/// A poisoned lock still holds consistent data here (plain inserts/removes).
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl GitState {
    /// `Disabled` unless the setting is on; never runs anything.
    pub fn check_enabled(&self) -> Result<(), GitError> {
        if self.enabled.load(Ordering::SeqCst) {
            Ok(())
        } else {
            Err(GitError::new(GitKind::Disabled, "git sync is off"))
        }
    }

    /// Turns the setting on or off. Turning it on forgets a cached "not
    /// found", so the next `git()` looks again (as at startup); a found git
    /// stays cached. Runs nothing.
    #[cfg(test)]
    pub fn set_enabled(&self, on: bool) {
        self.set_switch(on);
        if on {
            self.forget_not_found();
        }
    }

    /// Flips the switch alone; never waits.
    pub fn set_switch(&self, on: bool) {
        self.enabled.store(on, Ordering::SeqCst);
    }

    /// Forgets a cached "not found" so the next `git()` looks again. Waits
    /// for a discovery in progress: call it off the async runtime.
    pub fn forget_not_found(&self) {
        let mut slot = lock(&self.git);
        if matches!(*slot, Some(None)) {
            *slot = None;
        }
    }

    /// The git to run: `Disabled` when off, else discovered once (lazily)
    /// and cached; `NoGit` if none was found.
    pub fn git(&self) -> Result<Git, GitError> {
        self.git_with(find_git)
    }

    /// `git`, discovering with `find`.
    fn git_with(&self, find: impl FnOnce() -> Option<Git>) -> Result<Git, GitError> {
        self.check_enabled()?;
        let mut slot = lock(&self.git);
        slot.get_or_insert_with(find)
            .clone()
            .ok_or_else(|| GitError::new(GitKind::NoGit, "git was not found"))
    }

    /// Whether a discovery so far found git; runs nothing and never waits:
    /// while a discovery is in progress the answer is unknown, so `false`.
    pub fn known_available(&self) -> bool {
        let slot = match self.git.try_lock() {
            Ok(slot) => slot,
            Err(std::sync::TryLockError::Poisoned(e)) => e.into_inner(),
            Err(std::sync::TryLockError::WouldBlock) => return false,
        };
        matches!(*slot, Some(Some(_)))
    }

    /// Marks `key` busy until the guard drops; `Busy` if it already is.
    pub fn lock(&self, key: String) -> Result<BusyGuard<'_>, GitError> {
        if !lock(&self.busy).insert(key.clone()) {
            return Err(GitError::new(
                GitKind::Busy,
                "another git action is running on this folder",
            ));
        }
        Ok(BusyGuard { state: self, key })
    }

    /// Remembers a picked clone parent and returns its token. Only the
    /// latest pick is kept: a new one replaces any earlier.
    pub fn add_pick(&self, parent: PathBuf) -> String {
        let token = format!("pick-{}", self.next_pick.fetch_add(1, Ordering::SeqCst));
        let mut picks = lock(&self.picks);
        picks.clear();
        picks.insert(token.clone(), parent);
        token
    }

    /// The parent picked under `token`, kept for a retry after a failed
    /// clone.
    pub fn pick(&self, token: &str) -> Option<PathBuf> {
        lock(&self.picks).get(token).cloned()
    }

    /// Uses up the pick under `token` (once its clone succeeded).
    pub fn take_pick(&self, token: &str) -> Option<PathBuf> {
        lock(&self.picks).remove(token)
    }

    /// A fresh cancel flag under `id`, registered until the result drops.
    pub fn register_cancel(&self, id: String) -> CancelReg<'_> {
        let flag: CancelFlag = Arc::new(AtomicBool::new(false));
        lock(&self.cancels).insert(id.clone(), flag.clone());
        CancelReg {
            state: self,
            id,
            flag,
        }
    }

    /// Sets the cancel flag under `id`, if an operation holds one.
    pub fn cancel(&self, id: &str) {
        if let Some(flag) = lock(&self.cancels).get(id) {
            flag.store(true, Ordering::SeqCst);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disabled_state_never_discovers() {
        let st = GitState::default();
        let e = st.git().unwrap_err();
        assert_eq!(e.kind, GitKind::Disabled);
        assert!(st.git.lock().unwrap().is_none());
    }

    #[test]
    fn busy_lock_is_exclusive() {
        let st = GitState::default();
        let first = st.lock("k".into()).unwrap();
        assert_eq!(st.lock("k".into()).err().unwrap().kind, GitKind::Busy);
        assert!(st.lock("other".into()).is_ok());
        drop(first);
        assert!(st.lock("k".into()).is_ok());
    }

    #[test]
    fn pick_survives_failed_clone_and_is_consumed_on_success() {
        let st = GitState::default();
        let token = st.add_pick(PathBuf::from("parent"));
        // A failed clone only looks: a retry finds it again.
        assert_eq!(st.pick(&token), Some(PathBuf::from("parent")));
        assert_eq!(st.pick(&token), Some(PathBuf::from("parent")));
        // A successful one uses it up.
        assert_eq!(st.take_pick(&token), Some(PathBuf::from("parent")));
        assert_eq!(st.pick(&token), None);
        assert_eq!(st.take_pick(&token), None);
    }

    #[test]
    fn a_new_pick_replaces_older_ones() {
        let st = GitState::default();
        let old = st.add_pick(PathBuf::from("a"));
        let new = st.add_pick(PathBuf::from("b"));
        assert_eq!(st.pick(&old), None);
        assert_eq!(st.pick(&new), Some(PathBuf::from("b")));
    }

    #[test]
    fn enabling_retries_a_not_found_git_but_keeps_a_found_one() {
        let st = GitState::default();
        st.set_enabled(true);
        assert_eq!(st.git_with(|| None).unwrap_err().kind, GitKind::NoGit);
        // Cached while it stays on: no new discovery.
        let e = st.git_with(|| panic!("rediscovered")).unwrap_err();
        assert_eq!(e.kind, GitKind::NoGit);
        // Turning it on again looks again.
        st.set_enabled(false);
        st.set_enabled(true);
        assert!(st.git_with(find_git).is_ok());
        assert!(st.known_available());
        // A found git stays cached across a re-enable.
        st.set_enabled(true);
        assert!(st.git_with(|| panic!("rediscovered")).is_ok());
    }

    #[test]
    fn known_available_does_not_wait_for_a_discovery() {
        let st = GitState::default();
        st.set_enabled(true);
        assert!(st.git_with(find_git).is_ok());
        assert!(st.known_available());
        // A discovery in progress holds the slot: the answer is "unknown".
        let held = st.git.lock().unwrap();
        assert!(!st.known_available());
        drop(held);
        assert!(st.known_available());
    }

    #[test]
    fn switching_off_keeps_what_was_found() {
        let st = GitState::default();
        st.set_switch(true);
        st.forget_not_found();
        assert!(st.git_with(find_git).is_ok());
        st.set_switch(false);
        assert_eq!(st.check_enabled().unwrap_err().kind, GitKind::Disabled);
        assert!(st.known_available());
    }

    #[test]
    fn cancel_sets_the_registered_flag_until_done() {
        let st = GitState::default();
        st.cancel("op"); // nothing registered: a no-op
        let reg = st.register_cancel("op".into());
        st.cancel("op");
        assert!(reg.flag.load(Ordering::SeqCst));
        drop(reg);
        assert!(lock(&st.cancels).is_empty());
    }
}
