mod cipher;
mod error;
mod generator;
mod kdf;
mod passkey;
mod recovery;
mod rng;
mod sharing;

pub use cipher::{EncString, SymmetricKey};
pub use error::CryptoError;
pub use generator::{PasswordOptions, generate_password};
pub use kdf::{AuthKey, KdfParams, MasterKey, SALT_LEN, derive_master_key, generate_salt};
pub use recovery::{RecoveryKey, fingerprint};
pub use sharing::{
    KeyPair, PublicKey, SealedKey, VaultKeyContext, item_aad, seal_vault_key, unwrap_account_key,
    vault_meta_aad, wrap_account_key,
};

pub use passkey::{PasskeyAssertion, PasskeyRegistration, assert_passkey, create_passkey};
