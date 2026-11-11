use crate::{CryptoError, EncString, SymmetricKey};
use ciborium::value::Value;
use p256::ecdsa::{Signature, SigningKey, signature::Signer};
use rand::{RngCore, rngs::OsRng};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

pub struct PasskeyRegistration {
    pub credential_id: Vec<u8>,
    pub encrypted_key: String,
    pub attestation: Vec<u8>,
}

pub struct PasskeyAssertion {
    pub authenticator_data: Vec<u8>,
    pub signature: Vec<u8>,
}

fn valid_rp(rp: &str) -> bool {
    !rp.is_empty()
        && rp.len() <= 253
        && rp.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        })
}

fn aad(rp: &str, id: &[u8]) -> Vec<u8> {
    let mut result = b"melon/passkey/v1/".to_vec();
    result.extend_from_slice(&(rp.len() as u32).to_be_bytes());
    result.extend_from_slice(rp.as_bytes());
    result.extend_from_slice(id);
    result
}

fn cbor(value: Value) -> Result<Vec<u8>, CryptoError> {
    let mut output = Vec::new();
    ciborium::ser::into_writer(&value, &mut output).map_err(|_| CryptoError::Malformed)?;
    Ok(output)
}

fn auth_data(rp: &str, flags: u8) -> Vec<u8> {
    let mut data = Sha256::digest(rp.as_bytes()).to_vec();
    data.push(flags);
    data.extend_from_slice(&[0; 4]);
    data
}

pub fn create_passkey(
    cache_key: &SymmetricKey,
    rp: &str,
) -> Result<PasskeyRegistration, CryptoError> {
    if !valid_rp(rp) {
        return Err(CryptoError::Malformed);
    }
    let signing = SigningKey::random(&mut OsRng);
    let private = Zeroizing::new(signing.to_bytes());
    let mut id = vec![0; 32];
    OsRng.fill_bytes(&mut id);
    let public = signing.verifying_key().to_encoded_point(false);
    let cose = Value::Map(vec![
        (Value::Integer(1.into()), Value::Integer(2.into())),
        (Value::Integer(3.into()), Value::Integer((-7).into())),
        (Value::Integer((-1).into()), Value::Integer(1.into())),
        (
            Value::Integer((-2).into()),
            Value::Bytes(public.x().ok_or(CryptoError::Malformed)?.to_vec()),
        ),
        (
            Value::Integer((-3).into()),
            Value::Bytes(public.y().ok_or(CryptoError::Malformed)?.to_vec()),
        ),
    ]);
    let mut data = auth_data(rp, 0x45);
    data.extend_from_slice(&[0; 16]);
    data.extend_from_slice(&(id.len() as u16).to_be_bytes());
    data.extend_from_slice(&id);
    data.extend_from_slice(&cbor(cose)?);
    let attestation = cbor(Value::Map(vec![
        (Value::Text("fmt".into()), Value::Text("none".into())),
        (Value::Text("attStmt".into()), Value::Map(vec![])),
        (Value::Text("authData".into()), Value::Bytes(data)),
    ]))?;
    Ok(PasskeyRegistration {
        encrypted_key: cache_key
            .encrypt(private.as_slice(), &aad(rp, &id))
            .to_string(),
        credential_id: id,
        attestation,
    })
}

pub fn assert_passkey(
    cache_key: &SymmetricKey,
    rp: &str,
    id: &[u8],
    encrypted_key: &str,
    client_hash: &[u8],
) -> Result<PasskeyAssertion, CryptoError> {
    if !valid_rp(rp) || id.len() != 32 || client_hash.len() != 32 {
        return Err(CryptoError::Malformed);
    }
    let private = cache_key.decrypt(&EncString::parse(encrypted_key)?, &aad(rp, id))?;
    let signing = SigningKey::from_slice(&private).map_err(|_| CryptoError::Malformed)?;
    let authenticator_data = auth_data(rp, 0x05);
    let mut message = authenticator_data.clone();
    message.extend_from_slice(client_hash);
    let signature: Signature = signing.sign(&message);
    Ok(PasskeyAssertion {
        authenticator_data,
        signature: signature.to_der().as_bytes().to_vec(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use p256::ecdsa::signature::Verifier;

    #[test]
    fn registration_and_assertion_verify_and_bind_challenge() {
        let key = SymmetricKey::generate();
        let registration = create_passkey(&key, "example.com").unwrap();
        let attestation: Value =
            ciborium::de::from_reader(registration.attestation.as_slice()).unwrap();
        let fields = attestation.as_map().unwrap();
        let data = fields
            .iter()
            .find(|(k, _)| k.as_text() == Some("authData"))
            .unwrap()
            .1
            .as_bytes()
            .unwrap();
        assert_eq!(&data[..32], Sha256::digest(b"example.com").as_slice());
        assert_eq!(data[32], 0x45);
        assert_eq!(&data[53..55], &[0, 32]);
        assert_eq!(&data[55..87], registration.credential_id);
        let cose: Value = ciborium::de::from_reader(&data[87..]).unwrap();
        assert_eq!(cose.as_map().unwrap().len(), 5);
        let assertion = assert_passkey(
            &key,
            "example.com",
            &registration.credential_id,
            &registration.encrypted_key,
            &[9; 32],
        )
        .unwrap();
        let private = key
            .decrypt(
                &EncString::parse(&registration.encrypted_key).unwrap(),
                &aad("example.com", &registration.credential_id),
            )
            .unwrap();
        let signer = SigningKey::from_slice(&private).unwrap();
        let mut message = assertion.authenticator_data.clone();
        message.extend_from_slice(&[9; 32]);
        let signature = Signature::from_der(&assertion.signature).unwrap();
        assert!(signer.verifying_key().verify(&message, &signature).is_ok());
        message[40] ^= 1;
        assert!(signer.verifying_key().verify(&message, &signature).is_err());
        assert_eq!(assertion.authenticator_data[32], 0x05);
    }

    #[test]
    fn wrong_rp_key_id_hash_and_tampered_key_fail() {
        let key = SymmetricKey::generate();
        let r = create_passkey(&key, "example.com").unwrap();
        assert!(
            assert_passkey(
                &key,
                "evil.example.com",
                &r.credential_id,
                &r.encrypted_key,
                &[1; 32]
            )
            .is_err()
        );
        assert!(
            assert_passkey(
                &SymmetricKey::generate(),
                "example.com",
                &r.credential_id,
                &r.encrypted_key,
                &[1; 32]
            )
            .is_err()
        );
        assert!(assert_passkey(&key, "example.com", &[0; 32], &r.encrypted_key, &[1; 32]).is_err());
        assert!(
            assert_passkey(
                &key,
                "example.com",
                &r.credential_id,
                &r.encrypted_key,
                &[1; 31]
            )
            .is_err()
        );
        assert!(
            assert_passkey(
                &key,
                "example.com",
                &r.credential_id,
                "1.tampered",
                &[1; 32]
            )
            .is_err()
        );
        for rp in [
            "",
            "https://example.com",
            "example.com/evil",
            "Example.com",
            "evil..com",
        ] {
            assert!(create_passkey(&key, rp).is_err());
        }
    }
}
