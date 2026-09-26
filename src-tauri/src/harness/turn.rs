//! Typed turn state machine:
//! Idle → Preparing → Streaming → Committing → Next | Stopped | Error

use std::fmt;

/// Lifecycle phase of a single agent turn (or the idle gap between turns).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TurnPhase {
    #[default]
    Idle,
    Preparing,
    Streaming,
    Committing,
    /// Ready for the next speaker (auto cycle continues).
    Next,
    Stopped,
    Error,
}

impl fmt::Display for TurnPhase {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{self:?}")
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransitionError {
    pub from: TurnPhase,
    pub attempted: &'static str,
}

impl fmt::Display for TransitionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "invalid harness transition: {:?} cannot {}",
            self.from, self.attempted
        )
    }
}

impl std::error::Error for TransitionError {}

/// Drives prepare → stream → commit → next (or stop/error).
/// Pause is owned by AppState flags / loop, not this machine.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TurnMachine {
    phase: TurnPhase,
}

impl TurnMachine {
    pub fn new() -> Self {
        Self {
            phase: TurnPhase::Idle,
        }
    }

    pub fn phase(&self) -> TurnPhase {
        self.phase
    }

    fn go(&mut self, next: TurnPhase) {
        self.phase = next;
    }

    fn fail_trans(&self, attempted: &'static str) -> TransitionError {
        TransitionError {
            from: self.phase,
            attempted,
        }
    }

    /// Idle | Next → Preparing
    pub fn begin_prepare(&mut self) -> Result<(), TransitionError> {
        match self.phase {
            TurnPhase::Idle | TurnPhase::Next => {
                self.go(TurnPhase::Preparing);
                Ok(())
            }
            _ => Err(self.fail_trans("begin_prepare")),
        }
    }

    /// Preparing → Streaming
    pub fn begin_stream(&mut self) -> Result<(), TransitionError> {
        match self.phase {
            TurnPhase::Preparing => {
                self.go(TurnPhase::Streaming);
                Ok(())
            }
            _ => Err(self.fail_trans("begin_stream")),
        }
    }

    /// Streaming → Committing
    pub fn begin_commit(&mut self) -> Result<(), TransitionError> {
        match self.phase {
            TurnPhase::Streaming => {
                self.go(TurnPhase::Committing);
                Ok(())
            }
            _ => Err(self.fail_trans("begin_commit")),
        }
    }

    /// Committing → Next (auto continues)
    pub fn to_next(&mut self) -> Result<(), TransitionError> {
        match self.phase {
            TurnPhase::Committing => {
                self.go(TurnPhase::Next);
                Ok(())
            }
            _ => Err(self.fail_trans("to_next")),
        }
    }

    /// Hard stop — keep transcript; epoch bump happens outside.
    /// Prefer this for pre-stream cancel (stream never started).
    pub fn stop(&mut self) {
        self.go(TurnPhase::Stopped);
    }

    /// Stream/API failure.
    pub fn fail(&mut self) {
        self.go(TurnPhase::Error);
    }

    /// Abort mid-stream without commit (cancel / epoch bump after stream began).
    pub fn abort_stream(&mut self) {
        match self.phase {
            TurnPhase::Streaming | TurnPhase::Preparing | TurnPhase::Committing => {
                self.go(TurnPhase::Stopped);
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn happy_path_prepare_stream_commit_next() {
        let mut m = TurnMachine::new();
        assert_eq!(m.phase(), TurnPhase::Idle);
        m.begin_prepare().unwrap();
        assert_eq!(m.phase(), TurnPhase::Preparing);
        m.begin_stream().unwrap();
        assert_eq!(m.phase(), TurnPhase::Streaming);
        m.begin_commit().unwrap();
        assert_eq!(m.phase(), TurnPhase::Committing);
        m.to_next().unwrap();
        assert_eq!(m.phase(), TurnPhase::Next);
        // Next turn
        m.begin_prepare().unwrap();
        assert_eq!(m.phase(), TurnPhase::Preparing);
    }

    #[test]
    fn rejects_stream_before_prepare() {
        let mut m = TurnMachine::new();
        assert!(m.begin_stream().is_err());
    }

    #[test]
    fn stop_and_fail_terminal() {
        let mut m = TurnMachine::new();
        m.begin_prepare().unwrap();
        m.stop();
        assert_eq!(m.phase(), TurnPhase::Stopped);

        let mut m2 = TurnMachine::new();
        m2.begin_prepare().unwrap();
        m2.begin_stream().unwrap();
        m2.fail();
        assert_eq!(m2.phase(), TurnPhase::Error);
    }

    #[test]
    fn abort_stream_marks_stopped() {
        let mut m = TurnMachine::new();
        m.begin_prepare().unwrap();
        m.begin_stream().unwrap();
        m.abort_stream();
        assert_eq!(m.phase(), TurnPhase::Stopped);
    }

    #[test]
    fn pre_stream_cancel_uses_stop() {
        let mut m = TurnMachine::new();
        m.begin_prepare().unwrap();
        m.stop();
        assert_eq!(m.phase(), TurnPhase::Stopped);
    }

    #[test]
    fn next_allows_prepare_again() {
        let mut m = TurnMachine::new();
        m.begin_prepare().unwrap();
        m.begin_stream().unwrap();
        m.begin_commit().unwrap();
        m.to_next().unwrap();
        assert!(m.begin_prepare().is_ok());
    }
}
