use std::{
    convert::Infallible,
    net::{IpAddr, SocketAddr},
};

use axum::{
    extract::{ConnectInfo, FromRequestParts},
    http::request::Parts,
};

use crate::state::AppState;

pub struct ClientIp(pub Option<IpAddr>);

impl FromRequestParts<AppState> for ClientIp {
    type Rejection = Infallible;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Infallible> {
        let forwarded = state
            .config
            .trust_proxy
            .then(|| forwarded_for(parts))
            .flatten();
        Ok(Self(forwarded.or_else(|| {
            parts
                .extensions
                .get::<ConnectInfo<SocketAddr>>()
                .map(|c| c.0.ip())
        })))
    }
}

fn forwarded_for(parts: &Parts) -> Option<IpAddr> {
    let last = parts
        .headers
        .get_all("x-forwarded-for")
        .iter()
        .next_back()?
        .to_str()
        .ok()?
        .rsplit(',')
        .next()?;
    last.trim().parse().ok()
}

pub fn limiter_key(ip: IpAddr) -> String {
    match ip {
        IpAddr::V4(v4) => format!("ip:{v4}"),
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => format!("ip:{v4}"),
            None => {
                let s = v6.segments();
                format!("ip:{:x}:{:x}:{:x}:{:x}::/64", s[0], s[1], s[2], s[3])
            }
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::Request;

    fn parts(headers: &[&str]) -> Parts {
        let mut req = Request::builder();
        for h in headers {
            req = req.header("x-forwarded-for", *h);
        }
        req.body(()).unwrap().into_parts().0
    }

    #[test]
    fn only_the_entry_added_by_the_proxy_counts() {
        assert_eq!(
            forwarded_for(&parts(&["6.6.6.6, 203.0.113.9"])),
            Some("203.0.113.9".parse().unwrap())
        );
        assert_eq!(
            forwarded_for(&parts(&["6.6.6.6", "203.0.113.9"])),
            Some("203.0.113.9".parse().unwrap())
        );
        assert_eq!(forwarded_for(&parts(&["6.6.6.6, garbage"])), None);
        assert_eq!(forwarded_for(&parts(&[])), None);
    }

    #[test]
    fn ipv6_addresses_share_a_limit_per_64_network() {
        let a = limiter_key("2001:db8:1:2:aaaa::1".parse().unwrap());
        let b = limiter_key("2001:db8:1:2:bbbb::7".parse().unwrap());
        let c = limiter_key("2001:db8:1:3::1".parse().unwrap());
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert_eq!(
            limiter_key("::ffff:203.0.113.9".parse().unwrap()),
            "ip:203.0.113.9"
        );
    }
}
