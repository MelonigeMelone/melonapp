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
    pub ip_limiter: LoginLimiter,
}

impl AppState {
    pub fn new(db: PgPool, config: Config) -> anyhow::Result<Self> {
        Ok(Self(Arc::new(Inner {
            db,
            config,
            dummy_hash: hash_auth_key(&[0u8; 32])?,
            limiter: LoginLimiter::default(),
            ip_limiter: LoginLimiter::with_max(MAX_FAILURES_PER_IP),
        })))
    }
}

impl Inner {
    pub fn begin_attempt(&self, key: &str, ip_key: Option<&str>) -> bool {
        if !self.limiter.try_begin(key) {
            return false;
        }
        let ip_ok = ip_key.is_none_or(|ip| self.ip_limiter.try_begin(ip));
        if !ip_ok {
            self.limiter.release(key);
        }
        ip_ok
    }

    pub fn attempt_succeeded(&self, key: &str, ip_key: Option<&str>) {
        self.limiter.reset(key);
        if let Some(ip) = ip_key {
            self.ip_limiter.release(ip);
        }
    }
}

impl Deref for AppState {
    type Target = Inner;
    fn deref(&self) -> &Inner {
        &self.0
    }
}

const MAX_FAILURES: u32 = 10;
const MAX_FAILURES_PER_IP: u32 = 30;
const WINDOW: Duration = Duration::from_secs(15 * 60);
const MAX_TRACKED: usize = 10_000;

pub struct LoginLimiter {
    failures: Mutex<HashMap<String, (u32, Instant)>>,
    max: u32,
}

impl Default for LoginLimiter {
    fn default() -> Self {
        Self::with_max(MAX_FAILURES)
    }
}

impl LoginLimiter {
    pub fn with_max(max: u32) -> Self {
        Self {
            failures: Mutex::new(HashMap::new()),
            max,
        }
    }

    pub fn try_begin(&self, key: &str) -> bool {
        let mut map = self.failures.lock().expect("limiter mutex poisoned");
        if map.len() >= MAX_TRACKED {
            map.retain(|_, (_, since)| since.elapsed() < WINDOW);
        }
        let entry = map.entry(key.to_owned()).or_insert((0, Instant::now()));
        if entry.1.elapsed() >= WINDOW {
            *entry = (0, Instant::now());
        }
        if entry.0 >= self.max {
            return false;
        }
        entry.0 += 1;
        true
    }

    pub fn release(&self, key: &str) {
        if let Some(entry) = self
            .failures
            .lock()
            .expect("limiter mutex poisoned")
            .get_mut(key)
        {
            entry.0 = entry.0.saturating_sub(1);
        }
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
    fn blocks_after_max_attempts_and_counts_before_the_slow_check() {
        let l = LoginLimiter::default();
        for _ in 0..MAX_FAILURES {
            assert!(l.try_begin("a"));
        }
        assert!(!l.try_begin("a"));
        assert!(l.try_begin("b"));
        l.release("a");
        assert!(l.try_begin("a"));
        assert!(!l.try_begin("a"));
        l.reset("a");
        assert!(l.try_begin("a"));
    }
}
