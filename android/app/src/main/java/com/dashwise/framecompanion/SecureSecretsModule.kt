package com.dashwise.framecompanion

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.spec.GCMParameterSpec

class SecureSecretsModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "SecureSecrets"

  @ReactMethod
  fun setSecret(key: String, value: String, promise: Promise) {
    try {
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.ENCRYPT_MODE, secretKey())
      val encrypted = cipher.doFinal(value.toByteArray(StandardCharsets.UTF_8))
      val payload = "${Base64.encodeToString(cipher.iv, Base64.NO_WRAP)}:${Base64.encodeToString(encrypted, Base64.NO_WRAP)}"
      context.getSharedPreferences(PREFS, 0).edit().putString(key, payload).apply()
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("secure_storage_error", "Unable to store secret", error)
    }
  }

  @ReactMethod
  fun getSecret(key: String, promise: Promise) {
    try {
      val payload = context.getSharedPreferences(PREFS, 0).getString(key, null)
      if (payload == null) {
        promise.resolve(null)
        return
      }
      val parts = payload.split(":", limit = 2)
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)))
      promise.resolve(String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8))
    } catch (error: Exception) {
      promise.reject("secure_storage_error", "Unable to read secret", error)
    }
  }

  @ReactMethod
  fun deleteSecret(key: String, promise: Promise) {
    context.getSharedPreferences(PREFS, 0).edit().remove(key).apply()
    promise.resolve(null)
  }

  private fun secretKey(): java.security.Key {
    val keyStore = KeyStore.getInstance(ANDROID_KEY_STORE).apply { load(null) }
    val existing = keyStore.getKey(KEY_ALIAS, null)
    if (existing != null) return existing
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEY_STORE)
    generator.init(KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
    return generator.generateKey()
  }

  companion object {
    private const val PREFS = "framecompanion.secure"
    private const val KEY_ALIAS = "framecompanion.secret.key"
    private const val ANDROID_KEY_STORE = "AndroidKeyStore"

    fun readSecret(context: android.content.Context, key: String): String? {
      return try {
        val payload = context.getSharedPreferences(PREFS, 0).getString(key, null) ?: return null
        val parts = payload.split(":", limit = 2)
        val keyStore = KeyStore.getInstance(ANDROID_KEY_STORE).apply { load(null) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, keyStore.getKey(KEY_ALIAS, null), GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)))
        String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8)
      } catch (_: Exception) {
        null
      }
    }
  }
}
