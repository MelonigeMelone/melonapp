use std::{env, net::SocketAddr};

use anyhow::{Context, bail};

#[derive(Clone)]
pub struct Config {
    pub database_url: String,
    pub bind_addr: SocketAddr,
    pub server_secret: Vec<u8>,
    pub allow_registration: bool,
    pub session_ttl_hours: i32,
    pub cors_origins: Vec<String>,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let database_url =
            env::var("MELON_DATABASE_URL").context("MELON_DATABASE_URL is required")?;
        let bind_addr = env::var("MELON_BIND")
            .unwrap_or_else(|_| "0.0.0.0:8080".into())
            .parse()
            .context("MELON_BIND must be host:port")?;
        let server_secret = env::var("MELON_SERVER_SECRET")
            .context("MELON_SERVER_SECRET is required (generate with: openssl rand -base64 48)")?
            .into_bytes();
        if server_secret.len() < 32 {
            bail!("MELON_SERVER_SECRET must be at least 32 characters");
        }
        let allow_registration = env::var("MELON_ALLOW_REGISTRATION")
            .map(|v| matches!(v.as_str(), "1" | "true" | "yes"))
            .unwrap_or(false);
        let session_ttl_hours = env::var("MELON_SESSION_TTL_HOURS")
            .ok()
            .map(|v| v.parse())
            .transpose()
            .context("MELON_SESSION_TTL_HOURS must be a number")?
            .unwrap_or(24 * 14);
        if !(1..=24 * 365).contains(&session_ttl_hours) {
            bail!("MELON_SESSION_TTL_HOURS must be between 1 and 8760");
        }
        let cors_origins = env::var("MELON_CORS_ORIGINS")
            .map(|v| {
                v.split(',')
                    .map(|s| s.trim().to_owned())
                    .filter(|s| !s.is_empty())
                    .collect()
            })
            .unwrap_or_default();

        Ok(Self {
            database_url,
            bind_addr,
            server_secret,
            allow_registration,
            session_ttl_hours,
            cors_origins,
        })
    }
}
