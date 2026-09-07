package com.dashwise.framecompanion

import android.Manifest

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.ComponentName
import android.app.admin.DevicePolicyManager
import android.provider.Settings
import android.net.Uri
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONObject

class FrameCompanionModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  init { instance = this }

  override fun getName() = "FrameCompanion"

  @ReactMethod
  fun getCapabilities(promise: Promise) {
    val sensors = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    val microphone = context.packageManager.hasSystemFeature(PackageManager.FEATURE_MICROPHONE)
    val result = Arguments.createMap().apply {
      putBoolean("light", sensors.getDefaultSensor(Sensor.TYPE_LIGHT) != null)
      putBoolean("vibration", sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) != null || sensors.getDefaultSensor(Sensor.TYPE_GYROSCOPE) != null)
      putBoolean("microphone", microphone && has(Manifest.permission.RECORD_AUDIO))
      putBoolean("secureStorage", true)
    }
    promise.resolve(result)
  }

  @ReactMethod
  fun configure(configJson: String, promise: Promise) {
    context.getSharedPreferences(PREFS, 0).edit().putString(CONFIG_KEY, configJson).apply()
    promise.resolve(null)
  }

  @ReactMethod
  fun startService(promise: Promise) {
    try {
      val intent = Intent(context, FrameCompanionService::class.java)
      if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("service_start_error", "Unable to start FrameCompanion background service", error)
    }
  }

  @ReactMethod
  fun stopService(promise: Promise) {
    context.stopService(Intent(context, FrameCompanionService::class.java))
    promise.resolve(null)
  }

  @ReactMethod
  fun getStatus(promise: Promise) {
    promise.resolve(statusMap(context))
  }

  @ReactMethod
  fun resetLightBaseline(promise: Promise) {
    context.getSharedPreferences(PREFS, 0).edit().remove(LIGHT_BASELINE_KEY).apply()
    LightModel(context).reset()
    promise.resolve(null)
  }

  @ReactMethod
  fun calibrateVibration(durationMs: Int, promise: Promise) {
    preferences(context).edit().putLong(VIBRATION_CALIBRATION_UNTIL, System.currentTimeMillis() + durationMs.coerceIn(1_000, 60_000)).remove(VIBRATION_BASELINE_KEY).apply()
    promise.resolve(null)
  }


  @ReactMethod
  fun getLocalIp(promise: Promise) {
    val address = (context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? android.net.wifi.WifiManager)?.connectionInfo?.ipAddress ?: 0
    if (address == 0) { promise.resolve(null); return }
    promise.resolve("${address and 0xff}.${address shr 8 and 0xff}.${address shr 16 and 0xff}.${address shr 24 and 0xff}")
  }

  @ReactMethod
  fun getAudioInputs(promise: Promise) {
    if (Build.VERSION.SDK_INT < 23) { promise.resolve(Arguments.createArray()); return }
    val audio = context.getSystemService(Context.AUDIO_SERVICE) as android.media.AudioManager
    val inputs = Arguments.createArray()
    audio.getDevices(android.media.AudioManager.GET_DEVICES_INPUTS).forEach { device ->
      inputs.pushMap(Arguments.createMap().apply { putInt("id", device.id); putString("name", device.productName?.toString() ?: "Input ${device.id}") })
    }
    promise.resolve(inputs)
  }

  @ReactMethod
  fun isDisplayAdminActive(promise: Promise) {
    val manager = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    promise.resolve(manager.isAdminActive(ComponentName(context, DisplayAdminReceiver::class.java)))
  }

  @ReactMethod
  fun requestDisplayAdmin(promise: Promise) {
    val intent = Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN).apply {
      putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, ComponentName(context, DisplayAdminReceiver::class.java))
      putExtra(DevicePolicyManager.EXTRA_ADD_EXPLANATION, "Allows FrameCompanion to power-lock the display from Home Assistant.")
    }
    try {
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("display_admin_unavailable", "Unable to open display power-control settings", error)
    }
  }

  @ReactMethod
  fun canWriteSettings(promise: Promise) {
    promise.resolve(Build.VERSION.SDK_INT < 23 || Settings.System.canWrite(context))
  }

  @ReactMethod
  fun requestWriteSettings(promise: Promise) {
    try {
      val intent = Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS, Uri.parse("package:${context.packageName}"))
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("write_settings_unavailable", "Unable to open Android write-settings permission", error)
    }
  }

  @ReactMethod
  fun testMqtt(configJson: String, promise: Promise) {
    try {
      val config = JSONObject(configJson)
      FrameCompanionService.testMqtt(context, config, promise)
    } catch (error: Exception) {
      promise.reject("mqtt_config_error", "Invalid MQTT configuration", error)
    }
  }

  private fun has(permission: String) = ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

  companion object {
    private const val PREFS = "framecompanion.service"
    const val CONFIG_KEY = "config"
    const val LIGHT_BASELINE_KEY = "light_baseline"
    const val VIBRATION_CALIBRATION_UNTIL = "vibration_calibration_until"
    const val VIBRATION_BASELINE_KEY = "vibration_baseline"
    const val DISPLAY_ON_KEY = "display_on"
    private var instance: FrameCompanionModule? = null

    fun emitStatus(status: Map<String, Any?>) {
      lastStatus = lastStatus + status.filterValues { it != null }
      val map = Arguments.createMap()
      status.forEach { (key, value) -> when (value) { is String -> map.putString(key, value); is Number -> map.putDouble(key, value.toDouble()); is Boolean -> map.putBoolean(key, value) } }
      instance?.reactApplicationContext?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)?.emit("status", map)
    }

    fun preferences(context: Context) = context.getSharedPreferences(PREFS, 0)

    fun statusMap(context: Context): com.facebook.react.bridge.WritableMap {
      val result = Arguments.createMap()
      lastStatus.forEach { (key, value) -> when (value) { is String -> result.putString(key, value); is Number -> result.putDouble(key, value.toDouble()); is Boolean -> result.putBoolean(key, value) } }
      return result
    }

    private var lastStatus: Map<String, Any?> = emptyMap()
  }
}
