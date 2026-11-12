#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum CryptoError {
    #[error("KDF parameters are outside the allowed range")]
    InvalidKdfParams,
    #[error("salt length must be between 16 and 64 bytes")]
    InvalidSalt,
    #[error("key derivation failed")]
    Kdf,
    #[error("decryption failed")]
    Decrypt,
    #[error("malformed ciphertext")]
    Malformed,
    #[error("unsupported ciphertext version")]
    UnsupportedVersion,
    #[error("invalid key length")]
    InvalidKey,
    #[error("invalid recovery key")]
    InvalidRecoveryKey,
    #[error("invalid password generator options")]
    InvalidGeneratorOptions,
    #[error("export password must have at least 12 characters")]
    WeakExportPassword,
}
