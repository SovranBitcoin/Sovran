package expo.modules.bitchat

import android.content.Context
import android.content.SharedPreferences
import android.util.Base64
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.security.GeneralSecurityException
import java.security.MessageDigest
import javax.crypto.AEADBadTagException
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.params.X25519PrivateKeyParameters

class BitchatIdentityException(message: String) : Exception(message)

/**
 * Validated identity material derived from the JS-provided hex keys. Mirrors
 * the iOS BitchatBLEIdentityMaterial: peerID = first 16 hex chars of
 * SHA256(noise static public key) — identical on both platforms for the same
 * injected keys, which is what makes Sovran iOS and Android builds
 * protocol-identical peers.
 */
class BitchatIdentityMaterial(
    noisePrivateKeyHex: String,
    signingPrivateKeyHex: String,
    p2pkPubkeyHex: String,
) {
    val noisePrivateKey: ByteArray = decodeKey(noisePrivateKeyHex, "noise")
    val signingPrivateKey: ByteArray = decodeKey(signingPrivateKeyHex, "signing")

    /**
     * 33-byte compressed Cashu P2PK pubkey ("02" + nostr x-only) announced in
     * the SVRN extension TLV so nearby Sovran peers can lock tokens to us.
     */
    val p2pkPubkey: ByteArray = decodeP2pkPubkey(p2pkPubkeyHex)
    val noisePublicKey: ByteArray =
        X25519PrivateKeyParameters(noisePrivateKey, 0).generatePublicKey().encoded
    val signingPublicKey: ByteArray =
        Ed25519PrivateKeyParameters(signingPrivateKey, 0).generatePublicKey().encoded
    val peerID: String = sha256Hex(noisePublicKey).take(16)

    // The p2pk pubkey participates so a profile switch that changes only the
    // announced lock key still tears down and recreates the mesh service.
    val identityID: String = "$peerID:${signingPublicKey.toHex()}:${p2pkPubkey.toHex()}"

    private companion object {
        fun decodeKey(hex: String, name: String): ByteArray {
            if (!hex.matches(Regex("^[0-9a-f]{64}$"))) {
                throw BitchatIdentityException("Invalid BitChat identity material: $name key must be 32-byte lowercase hex")
            }
            return hex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
        }

        fun decodeP2pkPubkey(hex: String): ByteArray {
            if (!hex.matches(Regex("^02[0-9a-f]{64}$"))) {
                throw BitchatIdentityException("Invalid BitChat identity material: p2pk pubkey must be 33-byte 02-prefixed lowercase hex")
            }
            return hex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
        }

        fun sha256Hex(data: ByteArray): String =
            MessageDigest.getInstance("SHA-256").digest(data).toHex()

        fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }
    }
}

/**
 * Writes Sovran's deterministic identity keys into the two vendor key stores
 * (write-if-different), mirroring installDeterministicIdentity in
 * ios/BitChatBLEBridge.swift:
 *
 * - `bitchat_identity` (EncryptedSharedPreferences): static_private_key /
 *   static_public_key read by NoiseEncryptionService.loadOrGenerateKeys, plus
 *   signing_private_key / signing_public_key (same loader).
 * - `bitchat_crypto_secure` (EncryptedSharedPreferences):
 *   ed25519_signing_private_key — EncryptionService keeps a second Ed25519
 *   copy here and uses it for announce/packet signing. Both stores must hold
 *   the same key or announce signatures would not verify against the
 *   announced signing public key.
 *
 * Must run BEFORE BluetoothMeshService is constructed — myPeerID derives from
 * the persisted noise key at construction time.
 */
object BitchatIdentityInstaller {

    private const val TAG = "BitchatIdentityInstaller"

    fun install(scopedContext: Context, identity: BitchatIdentityMaterial) {
        withSelfHealingEncryptedPrefs(scopedContext, "bitchat_identity") { identityPrefs ->
            // Base64.DEFAULT matches the vendor's encode/decode calls.
            putIfDifferent(identityPrefs, "static_private_key", identity.noisePrivateKey)
            putIfDifferent(identityPrefs, "static_public_key", identity.noisePublicKey)
            putIfDifferent(identityPrefs, "signing_private_key", identity.signingPrivateKey)
            putIfDifferent(identityPrefs, "signing_public_key", identity.signingPublicKey)
        }

        withSelfHealingEncryptedPrefs(scopedContext, "bitchat_crypto_secure") { cryptoPrefs ->
            putIfDifferent(cryptoPrefs, "ed25519_signing_private_key", identity.signingPrivateKey)
        }
    }

    private fun withSelfHealingEncryptedPrefs(
        context: Context,
        name: String,
        block: (SharedPreferences) -> Unit,
    ) {
        try {
            block(encryptedPrefs(context, name))
        } catch (error: Exception) {
            if (!isEncryptedPrefsCorruption(error)) {
                throw error
            }

            Log.w(
                TAG,
                "BitChat encrypted prefs '$name' were unreadable; clearing the profile-scoped store and reinstalling deterministic identity.",
                error,
            )
            context.deleteSharedPreferences(name)
            block(encryptedPrefs(context, name))
        }
    }

    private fun encryptedPrefs(context: Context, name: String): SharedPreferences {
        val masterKey = MasterKey.Builder(context, MasterKey.DEFAULT_MASTER_KEY_ALIAS)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        return EncryptedSharedPreferences.create(
            context,
            name,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    private fun putIfDifferent(prefs: SharedPreferences, key: String, value: ByteArray) {
        val encoded = Base64.encodeToString(value, Base64.DEFAULT)
        val existing = prefs.getString(key, null)
        if (existing != null && Base64.decode(existing, Base64.DEFAULT).contentEquals(value)) {
            return
        }
        if (!prefs.edit().putString(key, encoded).commit()) {
            throw BitchatIdentityException("Failed to persist BitChat $key identity key")
        }
    }

    private fun isEncryptedPrefsCorruption(error: Throwable): Boolean {
        var current: Throwable? = error
        while (current != null) {
            if (current is AEADBadTagException || current is GeneralSecurityException) {
                return true
            }
            current = current.cause
        }
        return false
    }
}
