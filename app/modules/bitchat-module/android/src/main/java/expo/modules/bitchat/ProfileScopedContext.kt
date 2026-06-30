package expo.modules.bitchat

import android.content.Context
import android.content.ContextWrapper
import android.content.SharedPreferences
import java.security.MessageDigest

/**
 * Per-profile storage scoping, mirroring iOS ProfileScopedBitchatKeychain:
 * the same trim/"default"/SHA256-hex rule so both platforms scope identically.
 */
object BitchatProfileScope {
    fun storageSuffix(profileScope: String): String {
        val trimmed = profileScope.trim()
        val source = trimmed.ifEmpty { "default" }
        val digest = MessageDigest.getInstance("SHA-256").digest(source.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }

    fun scopedPrefsName(suffix: String, name: String): String = "sovran_${suffix}_$name"
}

/**
 * ContextWrapper that prefixes every SharedPreferences file name with the
 * profile-scope suffix. The vendored bitchat-android code stores all state
 * (identity keys, fingerprints, seen-message caches) through
 * `context.getSharedPreferences(...)`, so wrapping the Context scopes all of
 * it per profile without touching vendor code. EncryptedSharedPreferences
 * keeps its Tink keyset inside the same named file, so the scoping is
 * complete for encrypted prefs too.
 *
 * `getApplicationContext()` returns this wrapper so vendor lookups like
 * `context.applicationContext.getSharedPreferences(...)` stay scoped.
 */
class ProfileScopedContext(base: Context, private val suffix: String) :
    ContextWrapper(base.applicationContext) {

    override fun getSharedPreferences(name: String, mode: Int): SharedPreferences =
        super.getSharedPreferences(BitchatProfileScope.scopedPrefsName(suffix, name), mode)

    override fun deleteSharedPreferences(name: String): Boolean =
        super.deleteSharedPreferences(BitchatProfileScope.scopedPrefsName(suffix, name))

    override fun getApplicationContext(): Context = this
}
