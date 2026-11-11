use std::{
    collections::HashMap,
    ops::Deref,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use sqlx::PgPool;

use crate::{auth::hash_auth_key, config::Config};

#[derive(Clone)]
pub struct AppState(Arc<Inner>);

pub struct Inner {
    pub db: PgPool,
    pub config: Config,
    pub dummy_hash: String,
    pub limiter: LoginLimiter,
}

impl AppState {
    pub fn new(db: PgPool, config: Config) -> anyhow::Result<Self> {
        Ok(Self(Arc::new(Inner {
            db,
            config,
            dummy_hash: hash_auth_key(&[0u8; 32])?,
            limiter: LoginLimiter::default(),
        })))
    }
}

impl Deref for AppState {
    type Target = Inner;
    fn deref(&self) -> &Inner {
        &self.0
    }
}

const MAX_FAILURES: u32 = 10;
const WINDOW: Duration = Duration::from_secs(15 * 60);
const MAX_TRACKED: usize = 10_000;

#[derive(Default)]
pub struct LoginLimiter {
    failures: Mutex<HashMap<String, (u32, Instant)>>,
}

impl LoginLimiter {
    pub fn is_blocked(&self, key: &str) -> bool {
        let map = self.failures.lock().expect("limiter mutex poisoned");
        map.get(key)
            .is_some_and(|(n, since)| *n >= MAX_FAILURES && since.elapsed() < WINDOW)
    }

    pub fn record_failure(&self, key: &str) {
        let mut map = self.failures.lock().expect("limiter mutex poisoned");
        if map.len() >= MAX_TRACKED {
            map.retain(|_, (_, since)| since.elapsed() < WINDOW);
        }
        let entry = map.entry(key.to_owned()).or_insert((0, Instant::now()));
        if entry.1.elapsed() >= WINDOW {
            *entry = (0, Instant::now());
        }
        entry.0 += 1;
    }

    pub fn reset(&self, key: &str) {
        self.failures
            .lock()
            .expect("limiter mutex poisoned")
            .remove(key);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_after_max_failures() {
        let l = LoginLimiter::default();
        for _ in 0..MAX_FAILURES - 1 {
            l.record_failure("a");
        }
        assert!(!l.is_blocked("a"));
        l.record_failure("a");
        assert!(l.is_blocked("a"));
        assert!(!l.is_blocked("b"));
        l.reset("a");
        assert!(!l.is_blocked("a"));
    }
}
