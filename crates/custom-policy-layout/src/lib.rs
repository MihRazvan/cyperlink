//! Fixed custom-policy-v1 layout. The legacy hook routing header stays intact.
use solana_sha256_hasher::hashv;
pub const STATE_LEN: usize = 353;
pub const PERMIT_LEN: usize = 712;
pub const STATE_IDENTITY: usize = 257;
pub const PERMIT_IDENTITY: usize = 616;
pub const ACTIVE_PERMIT_OFFSET: usize = 129;

pub fn identity(release: &[u8; 32], schema: &[u8; 32], domain: &[u8; 32]) -> [u8; 96] {
    let mut bytes = [0; 96];
    bytes[..32].copy_from_slice(release);
    bytes[32..64].copy_from_slice(schema);
    bytes[64..].copy_from_slice(domain);
    bytes
}
pub fn valid_state(data: &[u8], identity: &[u8; 96]) -> bool {
    data.len() == STATE_LEN && &data[STATE_IDENTITY..] == identity
}
pub fn valid_permit(data: &[u8], identity: &[u8; 96]) -> bool {
    data.len() == PERMIT_LEN && &data[PERMIT_IDENTITY..] == identity
}
/// Nonce and all four ciphertexts, with domain/schema/release separation.
pub fn state_hash(nonce_and_first: &[u8], rest: &[u8], identity: &[u8; 96]) -> [u8; 32] {
    assert_eq!(nonce_and_first.len(), 48);
    assert_eq!(rest.len(), 96);
    hashv(&[b"cyperlink-private-state-v1", identity, nonce_and_first, rest]).to_bytes()
}
pub fn state_ciphers(data: &[u8]) -> [[u8; 32]; 4] {
    assert_eq!(data.len(), STATE_LEN);
    let mut result = [[0; 32]; 4];
    result[0].copy_from_slice(&data[56..88]);
    for i in 1..4 { result[i].copy_from_slice(&data[161 + (i-1)*32..161+i*32]); }
    result
}
pub fn query_hash(data: &[u8]) -> [u8; 32] {
    assert_eq!(data.len(), STATE_LEN);
    hashv(&[b"cyperlink-policy-query-v1", data]).to_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn all_ciphertexts_nonce_and_identities_are_bound() {
        let initial = state_hash(&[0;48], &[0;96], &[0;96]);
        for i in 0..240 {
            let mut bytes=[0;240];bytes[i]=1;
            assert_ne!(initial,state_hash(&bytes[..48],&bytes[48..144],bytes[144..].try_into().unwrap()));
        }
    }
    #[test]
    fn every_query_byte_including_counter_and_padding_is_bound() {
        let data=[0;STATE_LEN];let initial=query_hash(&data);
        for i in 0..STATE_LEN {let mut changed=data;changed[i]=1;assert_ne!(initial,query_hash(&changed));}
        assert!(!valid_state(&data[..161],&[0;96]));
        assert!(!valid_permit(&[0;520],&[0;96]));
        assert_eq!(ACTIVE_PERMIT_OFFSET,129);
    }
}
