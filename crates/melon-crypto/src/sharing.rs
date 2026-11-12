use base64::{
    Engine,
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
};
use hpke::{
    Deserializable, Kem as _, OpModeR, OpModeS, Serializable, aead::ChaCha20Poly1305,
    kdf::HkdfSha256, kem::X25519HkdfSha256,
};
use zeroize::Zeroizing;

use crate::{CryptoError, EncString, SymmetricKey, rng::os_rng};

type Kem = X25519HkdfSha256;
type PrivateKey = <Kem as hpke::Kem>::PrivateKey;
type PublicKeyInner = <Kem as hpke::Kem>::PublicKey;

const SEALED_VERSION: &str = "h1";
const ENCAPPED_LEN: usize = 32;
const SEALED_KEY_CT_LEN: usize = 32 + 16;
const AAD_ACCOUNT_KEY: &[u8] = b"melon/v2/account-key";
const AAD_PRIVATE_KEY: &[u8] = b"melon/v2/private-key";

#[derive(Clone, PartialEq, Eq)]
pub struct PublicKey(PublicKeyInner);

impl PublicKey {
    pub fn from_base64(b64: &str) -> Result<Self, CryptoError> {
        let bytes = STANDARD.decode(b64).map_err(|_| CryptoError::InvalidKey)?;
        PublicKeyInner::from_bytes(&bytes)
            .map(Self)
            .map_err(|_| CryptoError::InvalidKey)
    }

    pub fn to_base64(&self) -> String {
        STANDARD.encode(self.0.to_bytes())
    }

    pub(crate) fn bytes(&self) -> Vec<u8> {
        self.0.to_bytes().to_vec()
    }
}

impl std::fmt::Debug for PublicKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "PublicKey({})", self.to_base64())
    }
}

pub struct KeyPair {
    private: PrivateKey,
    public: PublicKey,
}

impl KeyPair {
    pub fn generate() -> Self {
        let (private, public) = Kem::gen_keypair_with_rng(&mut os_rng());
        Self {
            private,
            public: PublicKey(public),
        }
    }

    pub fn public_key(&self) -> &PublicKey {
        &self.public
    }

    pub fn seal_with(&self, account_key: &SymmetricKey) -> EncString {
        let bytes = Zeroizing::new(self.private.to_bytes().to_vec());
        account_key.encrypt(&bytes, AAD_PRIVATE_KEY)
    }

    pub fn open_with(account_key: &SymmetricKey, sealed: &EncString) -> Result<Self, CryptoError> {
        let bytes = account_key.decrypt(sealed, AAD_PRIVATE_KEY)?;
        let private = PrivateKey::from_bytes(&bytes).map_err(|_| CryptoError::InvalidKey)?;
        let public = PublicKey(Kem::sk_to_pk(&private));
        Ok(Self { private, public })
    }

    pub fn open_vault_key(
        &self,
        sealed: &SealedKey,
        context: &VaultKeyContext,
    ) -> Result<SymmetricKey, CryptoError> {
        let (encapped, ct) = sealed.raw.split_at(ENCAPPED_LEN);
        let encapped = <Kem as hpke::Kem>::EncappedKey::from_bytes(encapped)
            .map_err(|_| CryptoError::Malformed)?;
        let plain = Zeroizing::new(
            hpke::single_shot_open::<ChaCha20Poly1305, HkdfSha256, Kem>(
                &OpModeR::Base,
                &self.private,
                &encapped,
                &context.info(),
                ct,
                b"",
            )
            .map_err(|_| CryptoError::Decrypt)?,
        );
        let arr: [u8; 32] = plain
            .as_slice()
            .try_into()
            .map_err(|_| CryptoError::InvalidKey)?;
        Ok(SymmetricKey::from_bytes(arr))
    }
}

pub struct VaultKeyContext<'a> {
    pub vault_id: &'a str,
    pub user_id: &'a str,
    pub key_version: u32,
}

impl VaultKeyContext<'_> {
    fn info(&self) -> Vec<u8> {
        let mut info = b"melon/v2/vault-key\0".to_vec();
        info.extend_from_slice(self.vault_id.as_bytes());
        info.push(0);
        info.extend_from_slice(self.user_id.as_bytes());
        info.push(0);
        info.extend_from_slice(self.key_version.to_string().as_bytes());
        info
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct SealedKey {
    raw: Vec<u8>,
}

impl SealedKey {
    pub fn parse(s: &str) -> Result<Self, CryptoError> {
        let (version, body) = s.split_once('.').ok_or(CryptoError::Malformed)?;
        if version != SEALED_VERSION {
            return Err(CryptoError::UnsupportedVersion);
        }
        let raw = URL_SAFE_NO_PAD
            .decode(body)
            .map_err(|_| CryptoError::Malformed)?;
        if raw.len() != ENCAPPED_LEN + SEALED_KEY_CT_LEN {
            return Err(CryptoError::Malformed);
        }
        Ok(Self { raw })
    }
}

impl std::fmt::Display for SealedKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{SEALED_VERSION}.{}", URL_SAFE_NO_PAD.encode(&self.raw))
    }
}

impl std::fmt::Debug for SealedKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "SealedKey({} bytes)", self.raw.len())
    }
}

pub fn seal_vault_key(
    recipient: &PublicKey,
    vault_key: &SymmetricKey,
    context: &VaultKeyContext,
) -> SealedKey {
    let (encapped, ct) = hpke::single_shot_seal_with_rng::<ChaCha20Poly1305, HkdfSha256, Kem>(
        &OpModeS::Base,
        &recipient.0,
        &context.info(),
        vault_key.as_bytes(),
        b"",
        &mut os_rng(),
    )
    .expect("HPKE sealing with a valid public key cannot fail");
    let mut raw = encapped.to_bytes().to_vec();
    raw.extend_from_slice(&ct);
    SealedKey { raw }
}

pub fn wrap_account_key(wrapping_key: &SymmetricKey, account_key: &SymmetricKey) -> EncString {
    wrapping_key.encrypt(account_key.as_bytes(), AAD_ACCOUNT_KEY)
}

pub fn unwrap_account_key(
    wrapping_key: &SymmetricKey,
    wrapped: &EncString,
) -> Result<SymmetricKey, CryptoError> {
    let bytes = wrapping_key.decrypt(wrapped, AAD_ACCOUNT_KEY)?;
    let arr: [u8; 32] = bytes
        .as_slice()
        .try_into()
        .map_err(|_| CryptoError::InvalidKey)?;
    Ok(SymmetricKey::from_bytes(arr))
}

pub fn item_aad(vault_id: &str, item_id: &str, key_version: u32) -> Vec<u8> {
    let mut aad = b"melon/v2/item\0".to_vec();
    aad.extend_from_slice(vault_id.as_bytes());
    aad.push(0);
    aad.extend_from_slice(item_id.as_bytes());
    aad.push(0);
    aad.extend_from_slice(key_version.to_string().as_bytes());
    aad
}

pub fn vault_meta_aad(vault_id: &str, key_version: u32) -> Vec<u8> {
    let mut aad = b"melon/v2/vault-meta\0".to_vec();
    aad.extend_from_slice(vault_id.as_bytes());
    aad.push(0);
    aad.extend_from_slice(key_version.to_string().as_bytes());
    aad
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx<'a>(vault: &'a str, user: &'a str, v: u32) -> VaultKeyContext<'a> {
        VaultKeyContext {
            vault_id: vault,
            user_id: user,
            key_version: v,
        }
    }

    #[test]
    fn vault_key_roundtrip_for_recipient() {
        let bob = KeyPair::generate();
        let vault_key = SymmetricKey::generate();
        let sealed = seal_vault_key(bob.public_key(), &vault_key, &ctx("v", "bob", 1));
        let parsed = SealedKey::parse(&sealed.to_string()).unwrap();
        let opened = bob.open_vault_key(&parsed, &ctx("v", "bob", 1)).unwrap();
        assert_eq!(opened.as_bytes(), vault_key.as_bytes());
    }

    #[test]
    fn other_person_cannot_open() {
        let bob = KeyPair::generate();
        let eve = KeyPair::generate();
        let sealed = seal_vault_key(
            bob.public_key(),
            &SymmetricKey::generate(),
            &ctx("v", "bob", 1),
        );
        assert_eq!(
            eve.open_vault_key(&sealed, &ctx("v", "bob", 1)).err(),
            Some(CryptoError::Decrypt)
        );
    }

    #[test]
    fn sealed_key_is_bound_to_vault_user_and_version() {
        let bob = KeyPair::generate();
        let sealed = seal_vault_key(
            bob.public_key(),
            &SymmetricKey::generate(),
            &ctx("v", "bob", 1),
        );
        for wrong in [ctx("w", "bob", 1), ctx("v", "eve", 1), ctx("v", "bob", 2)] {
            assert_eq!(
                bob.open_vault_key(&sealed, &wrong).err(),
                Some(CryptoError::Decrypt)
            );
        }
    }

    #[test]
    fn tampered_sealed_key_is_rejected() {
        let bob = KeyPair::generate();
        let mut sealed = seal_vault_key(
            bob.public_key(),
            &SymmetricKey::generate(),
            &ctx("v", "bob", 1),
        );
        let last = sealed.raw.len() - 1;
        sealed.raw[last] ^= 1;
        assert!(bob.open_vault_key(&sealed, &ctx("v", "bob", 1)).is_err());
    }

    #[test]
    fn private_key_roundtrips_through_account_key() {
        let account = SymmetricKey::generate();
        let pair = KeyPair::generate();
        let sealed = pair.seal_with(&account);
        let reopened = KeyPair::open_with(&account, &sealed).unwrap();
        assert_eq!(reopened.public_key(), pair.public_key());
        assert!(KeyPair::open_with(&SymmetricKey::generate(), &sealed).is_err());
    }

    #[test]
    fn account_key_wrap_roundtrip() {
        let wrapping = SymmetricKey::generate();
        let account = SymmetricKey::generate();
        let wrapped = wrap_account_key(&wrapping, &account);
        assert_eq!(
            unwrap_account_key(&wrapping, &wrapped).unwrap().as_bytes(),
            account.as_bytes()
        );
        assert!(unwrap_account_key(&SymmetricKey::generate(), &wrapped).is_err());
    }

    #[test]
    fn public_key_parsing() {
        let pair = KeyPair::generate();
        let b64 = pair.public_key().to_base64();
        assert_eq!(&PublicKey::from_base64(&b64).unwrap(), pair.public_key());
        assert!(PublicKey::from_base64("AAAA").is_err());
        assert!(PublicKey::from_base64("not base64!").is_err());
    }

    #[test]
    fn sealed_key_parsing_rejects_garbage() {
        assert_eq!(SealedKey::parse("nope").err(), Some(CryptoError::Malformed));
        assert_eq!(
            SealedKey::parse("h2.AAAA").err(),
            Some(CryptoError::UnsupportedVersion)
        );
        assert_eq!(
            SealedKey::parse("h1.AAAA").err(),
            Some(CryptoError::Malformed)
        );
    }

    #[test]
    fn item_aad_separates_contexts() {
        assert_ne!(item_aad("v", "i", 1), item_aad("v", "i", 2));
        assert_ne!(item_aad("v", "i", 1), item_aad("w", "i", 1));
        assert_ne!(item_aad("v", "ab", 1), item_aad("va", "b", 1));
        assert_ne!(vault_meta_aad("v", 1), item_aad("v", "", 1));
    }
}
