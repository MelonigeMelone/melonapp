use std::{
    collections::{HashMap, VecDeque},
    ops::Deref,
    sync::{Arc, Mutex, MutexGuard},
    time::{Duration, Instant},
};

use anyhow::anyhow;
use sqlx::PgPool;
use tokio::sync::Semaphore;

use crate::{
    auth::hash_auth_key,
    config::Config,
    error::{ApiError, ApiResult},
};

#[derive(Clone)]
pub struct AppState(Arc<Inner>);

pub struct Inner {
    pub db: PgPool,
    pub config: Config,
    pub dummy_hash: String,
    pub limiter: LoginLimiter,
    pub address_limiter: LoginLimiter,
    pub ip_limiter: LoginLimiter,
    pub lookups: LoginLimiter,
    argon: Semaphore,
}

impl AppState {
    pub fn new(db: PgPool, config: Config) -> anyhow::Result<Self> {
        let workers = std::thread::available_parallelism().map_or(2, |n| n.get().clamp(2, 16));
        Ok(Self(Arc::new(Inner {
            db,
            config,
            dummy_hash: hash_auth_key(&[0u8; 32])?,
            limiter: LoginLimiter::with_max(MAX_FAILURES_PER_ACCOUNT),
            address_limiter: LoginLimiter::with_max(MAX_FAILURES_PER_ACCOUNT_AND_ADDRESS),
            ip_limiter: LoginLimiter::with_max(MAX_FAILURES_PER_IP),
            lookups: LoginLimiter::with_max(MAX_LOOKUPS_PER_USER),
            argon: Semaphore::new(workers),
        })))
    }
}

impl Inner {
    pub fn begin_attempt(&self, key: &str, ip_key: Option<&str>) -> bool {
        if let Some(ip) = ip_key {
            if !self.ip_limiter.try_begin(ip) {
                return false;
            }
        }
        let pair = format!("{key}|{}", ip_key.unwrap_or("unknown"));
        let address_ok = self.address_limiter.try_begin(&pair);
        let account_ok = address_ok && self.limiter.try_begin(key);
        if !account_ok {
            if address_ok {
                self.address_limiter.release(&pair);
            }
            if let Some(ip) = ip_key {
                self.ip_limiter.release(ip);
            }
        }
        account_ok
    }

    pub fn attempt_succeeded(&self, key: &str, ip_key: Option<&str>) {
        self.limiter.reset(key);
        self.address_limiter
            .reset(&format!("{key}|{}", ip_key.unwrap_or("unknown")));
        if let Some(ip) = ip_key {
            self.ip_limiter.release(ip);
        }
    }

    pub async fn argon<T, F>(&self, work: F) -> ApiResult<T>
    where
        F: FnOnce() -> T + Send + 'static,
        T: Send + 'static,
    {
        let _permit = tokio::time::timeout(ARGON_WAIT, self.argon.acquire())
            .await
            .map_err(|_| ApiError::TooManyRequests)?
            .map_err(|e| anyhow!(e))?;
        tokio::task::spawn_blocking(work)
            .await
            .map_err(|e| ApiError::Internal(anyhow!(e)))
    }
}

impl Deref for AppState {
    type Target = Inner;
    fn deref(&self) -> &Inner {
        &self.0
    }
}

const MAX_FAILURES_PER_ACCOUNT_AND_ADDRESS: u32 = 10;
const MAX_FAILURES_PER_ACCOUNT: u32 = 50;
const MAX_FAILURES_PER_IP: u32 = 30;
const MAX_LOOKUPS_PER_USER: u32 = 30;
const WINDOW: Duration = Duration::from_secs(15 * 60);
const MAX_TRACKED: usize = 10_000;
const ARGON_WAIT: Duration = Duration::from_secs(5);
const EVICTION_SCAN: usize = 64;

#[derive(Default)]
struct Table {
    entries: HashMap<String, (u32, Instant)>,
    order: VecDeque<(String, Instant)>,
}

impl Table {
    fn tidy(&mut self, now: Instant) {
        while let Some((key, since)) = self.order.front() {
            let current = self.entries.get(key).map(|e| e.1);
            if current == Some(*since) && now.duration_since(*since) < WINDOW {
                break;
            }
            if current == Some(*since) {
                self.entries.remove(key);
            }
            self.order.pop_front();
        }
    }

    fn evict_cheap(&mut self, now: Instant) -> bool {
        for _ in 0..EVICTION_SCAN.min(self.order.len()) {
            let Some((key, since)) = self.order.pop_front() else {
                return false;
            };
            let Some(&(count, current)) = self.entries.get(&key) else {
                continue;
            };
            if current != since {
                continue;
            }
            if count <= 1 || now.duration_since(since) >= WINDOW {
                self.entries.remove(&key);
                return true;
            }
            self.order.push_back((key, since));
        }
        false
    }
}

pub struct LoginLimiter {
    table: Mutex<Table>,
    max: u32,
    capacity: usize,
}

impl LoginLimiter {
    pub fn with_max(max: u32) -> Self {
        Self::with_capacity(max, MAX_TRACKED)
    }

    fn with_capacity(max: u32, capacity: usize) -> Self {
        Self {
            table: Mutex::new(Table::default()),
            max,
            capacity,
        }
    }

    fn table(&self) -> MutexGuard<'_, Table> {
        self.table
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    pub fn try_begin(&self, key: &str) -> bool {
        let now = Instant::now();
        let mut table = self.table();
        table.tidy(now);
        if let Some(entry) = table.entries.get_mut(key) {
            if now.duration_since(entry.1) >= WINDOW {
                *entry = (1, now);
                table.order.push_back((key.to_owned(), now));
                return true;
            }
            if entry.0 >= self.max {
                return false;
            }
            entry.0 += 1;
            return true;
        }
        if table.entries.len() >= self.capacity && !table.evict_cheap(now) {
            return false;
        }
        if table.order.len() > 2 * self.capacity {
            let Table { entries, order } = &mut *table;
            order.retain(|(k, since)| entries.get(k).map(|e| e.1) == Some(*since));
        }
        table.entries.insert(key.to_owned(), (1, now));
        table.order.push_back((key.to_owned(), now));
        true
    }

    pub fn release(&self, key: &str) {
        if let Some(entry) = self.table().entries.get_mut(key) {
            entry.0 = entry.0.saturating_sub(1);
        }
    }

    pub fn reset(&self, key: &str) {
        self.table().entries.remove(key);
    }

    #[cfg(test)]
    fn tracked(&self) -> (usize, usize) {
        let table = self.table();
        (table.entries.len(), table.order.len())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_after_max_attempts_and_counts_before_the_slow_check() {
        let l = LoginLimiter::with_max(10);
        for _ in 0..10 {
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

    #[test]
    fn a_flood_of_new_keys_does_not_push_out_a_blocked_key() {
        let l = LoginLimiter::with_capacity(10, 100);
        for _ in 0..10 {
            assert!(l.try_begin("victim"));
        }
        for _ in 0..3 {
            assert!(l.try_begin("tried-twice"));
        }
        for i in 0..10_000 {
            l.try_begin(&format!("junk-{i}"));
        }
        assert!(!l.try_begin("victim"), "the blocked key stays blocked");
        assert!(l.try_begin("tried-twice"), "keys with real counts are kept");
        let (entries, _) = l.tracked();
        assert!(entries <= 100);
    }

    #[test]
    fn a_table_full_of_counted_keys_refuses_new_ones_instead_of_forgetting() {
        let l = LoginLimiter::with_capacity(10, 50);
        for i in 0..50 {
            assert!(l.try_begin(&format!("k{i}")));
            assert!(l.try_begin(&format!("k{i}")));
        }
        assert!(!l.try_begin("new"));
        for i in 0..50 {
            assert!(l.try_begin(&format!("k{i}")));
        }
    }

    #[test]
    fn memory_stays_bounded_under_a_flood_of_new_keys() {
        let l = LoginLimiter::with_capacity(10, 100);
        for i in 0..50_000 {
            l.try_begin(&format!("{i}@example.com"));
            l.reset(&format!("{}@example.com", i / 2));
            assert!(l.try_begin("again@example.com"));
            l.reset("again@example.com");
        }
        let (entries, order) = l.tracked();
        assert!(entries <= 100, "{entries} entries");
        assert!(order <= 200, "{order} queued");
    }
}
