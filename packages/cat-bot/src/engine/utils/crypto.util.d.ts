/**
 * Credential Encryption Utility — AES-256-GCM
 *
 * Industry-standard authenticated encryption (AEAD) for platform credentials at rest.
 * AES-256-GCM provides three guarantees in a single pass:
 *   - Confidentiality   : AES-256 (256-bit key, 2^256 brute-force search space)
 *   - Integrity         : GCM auth tag detects any bit-flip or byte substitution
 *   - Authenticity      : same auth tag prevents forged ciphertexts reaching decrypt()
 *
 * Key material: 32 bytes (256 bits), sourced from ENCRYPTION_KEY env var as 64 hex chars.
 * IV:           12 bytes (96 bits), randomly generated per encrypt() call — NIST SP 800-38D
 *               recommendation for GCM; reusing an IV with the same key is cryptographically fatal.
 * Auth tag:     16 bytes (128 bits) — maximum GCM tag length, hardest to forge.
 *
 * Wire format: enc:v1:<iv_b64>:<authTag_b64>:<ciphertext_b64>
 *
 * The "enc:v1:" prefix serves two purposes:
 *   1. Graceful migration — decrypt() returns legacy plaintext values unchanged when
 *      the prefix is absent, so existing rows continue working after deployment without
 *      a forced DB rewrite migration.
 *   2. Versioning — a future key rotation can introduce enc:v2: with a different algorithm
 *      or key derivation scheme while decrypt() dispatches on the version token.
 *
 * ENCRYPTION_KEY must be kept secret and rotated if compromised. Rotate by:
 *   1. Generate new key with: openssl rand -hex 32
 *   2. Write a one-time migration script that reads enc:v1: values with the OLD key and
 *      re-encrypts with the new key, writing enc:v2: (or fresh enc:v1: with new key).
 *   3. Deploy with the new ENCRYPTION_KEY after the migration completes.
 */
/**
 * Encrypts a plaintext string with AES-256-GCM.
 *
 * A fresh random 12-byte IV is generated on every call — this is mandatory for GCM
 * security. Reusing an IV with the same key completely breaks confidentiality and
 * allows an attacker to XOR two ciphertexts to recover both plaintexts.
 *
 * @returns Encoded string: enc:v1:<iv>:<authTag>:<ciphertext> (all segments base64)
 */
export declare function encrypt(plaintext: string): string;
/**
 * Decrypts a value previously encrypted by encrypt().
 *
 * Graceful migration path: values that do NOT carry the enc:v1: prefix are assumed
 * to be legacy plaintext stored before encryption was deployed. They are returned
 * unchanged so existing DB rows work immediately after deployment without a forced
 * rewrite migration.
 *
 * @throws If the GCM auth tag verification fails — this indicates tampered or
 *         corrupted ciphertext and must never be silently swallowed by callers.
 */
export declare function decrypt(value: string): string;
/**
 * Returns true when a stored value has already been encrypted by this module.
 * Guards write paths against double-encrypting a credential that was read from
 * the DB and passed through the update flow unchanged.
 */
export declare function isEncrypted(value: string): boolean;
//# sourceMappingURL=crypto.util.d.ts.map