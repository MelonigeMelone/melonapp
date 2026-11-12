use rand::{RngExt, seq::SliceRandom};

use crate::rng::os_rng;
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::CryptoError;

const LOWER: &[u8] = b"abcdefghijklmnopqrstuvwxyz";
const UPPER: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS: &[u8] = b"0123456789";
const SYMBOLS: &[u8] = b"!@#$%^&*()-_=+[]{};:,.?/";
const AMBIGUOUS: &[u8] = b"Il1O0o";

const MIN_LEN: usize = 8;
const MAX_LEN: usize = 256;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PasswordOptions {
    pub length: usize,
    pub lowercase: bool,
    pub uppercase: bool,
    pub digits: bool,
    pub symbols: bool,
    pub avoid_ambiguous: bool,
}

impl Default for PasswordOptions {
    fn default() -> Self {
        Self {
            length: 20,
            lowercase: true,
            uppercase: true,
            digits: true,
            symbols: true,
            avoid_ambiguous: false,
        }
    }
}

pub fn generate_password(opts: &PasswordOptions) -> Result<Zeroizing<String>, CryptoError> {
    let sets: Vec<Vec<u8>> = [
        (opts.lowercase, LOWER),
        (opts.uppercase, UPPER),
        (opts.digits, DIGITS),
        (opts.symbols, SYMBOLS),
    ]
    .into_iter()
    .filter(|(enabled, _)| *enabled)
    .map(|(_, set)| {
        set.iter()
            .copied()
            .filter(|c| !opts.avoid_ambiguous || !AMBIGUOUS.contains(c))
            .collect()
    })
    .collect();

    if sets.is_empty() || !(MIN_LEN..=MAX_LEN).contains(&opts.length) || opts.length < sets.len() {
        return Err(CryptoError::InvalidGeneratorOptions);
    }

    let all: Vec<u8> = sets.concat();
    let mut rng = os_rng();
    let mut out = Zeroizing::new(Vec::with_capacity(opts.length));
    for set in &sets {
        out.push(set[rng.random_range(0..set.len())]);
    }
    while out.len() < opts.length {
        out.push(all[rng.random_range(0..all.len())]);
    }
    out.shuffle(&mut rng);

    let s = String::from_utf8(out.to_vec()).expect("charset is ASCII");
    Ok(Zeroizing::new(s))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_has_every_class() {
        for _ in 0..200 {
            let pw = generate_password(&PasswordOptions::default()).unwrap();
            assert_eq!(pw.len(), 20);
            assert!(pw.bytes().any(|c| LOWER.contains(&c)));
            assert!(pw.bytes().any(|c| UPPER.contains(&c)));
            assert!(pw.bytes().any(|c| DIGITS.contains(&c)));
            assert!(pw.bytes().any(|c| SYMBOLS.contains(&c)));
        }
    }

    #[test]
    fn respects_disabled_classes_and_ambiguity() {
        let opts = PasswordOptions {
            length: 64,
            symbols: false,
            avoid_ambiguous: true,
            ..Default::default()
        };
        for _ in 0..100 {
            let pw = generate_password(&opts).unwrap();
            assert!(pw.bytes().all(|c| c.is_ascii_alphanumeric()));
            assert!(pw.bytes().all(|c| !AMBIGUOUS.contains(&c)));
        }
    }

    #[test]
    fn passwords_differ() {
        let a = generate_password(&PasswordOptions::default()).unwrap();
        let b = generate_password(&PasswordOptions::default()).unwrap();
        assert_ne!(*a, *b);
    }

    #[test]
    fn invalid_options_are_rejected() {
        let none = PasswordOptions {
            lowercase: false,
            uppercase: false,
            digits: false,
            symbols: false,
            ..Default::default()
        };
        let short = PasswordOptions {
            length: 4,
            ..Default::default()
        };
        assert!(generate_password(&none).is_err());
        assert!(generate_password(&short).is_err());
    }
}
