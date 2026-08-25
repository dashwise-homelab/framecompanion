package com.dashwise.framecompanion

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.content.Context
import android.content.Intent
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
    val bluetooth = BluetoothAdapter.getDefaultAdapter() != null && (Build.VERSION.SDK_INT < 31 || has(Manifest.permission.BLUETOOTH_SCAN))
    val camera = context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)
    val microphone = context.packageManager.hasSystemFeature(PackageManager.FEATURE_MICROPHONE)
    val result = Arguments.createMap().apply {
      putBoolean("bluetooth", bluetooth)
      putBoolean("light", sensors.getDefaultSensor(Sensor.TYPE_LIGHT) != null)
      putBoolean("vibration", sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) != null || sensors.getDefaultSensor(Sensor.TYPE_GYROSCOPE) != null)
      putBoolean("microphone", microphone && has(Manifest.permission.RECORD_AUDIO))
      putBoolean("camera", camera && has(Manifest.permission.CAMERA))
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
    promise.resolve(FrameCompanionService.statusMap(context))
  }

  @ReactMethod
  fun resetLightBaseline(promise: Promise) {
    context.getSharedPreferences(PREFS, 0).edit().remove(LIGHT_BASELINE_KEY).apply()
    LightModel(context).reset()
    promise.resolve(null)
  }

  @ReactMethod
  fun scanNearby(promise: Promise) {
    if (Build.VERSION.SDK_INT >= 31 && !has(Manifest.permission.BLUETOOTH_SCAN)) {
      promise.reject("bluetooth_permission", "Nearby devices permission is required")
      return
    }
    val adapter = BluetoothAdapter.getDefaultAdapter()
    val scanner = adapter?.bluetoothLeScanner
    if (scanner == null) {
      promise.reject("bluetooth_unavailable", "Bluetooth LE scanner unavailable")
      return
    }
    val results = linkedMapOf<String, com.facebook.react.bridge.WritableMap>()
    val callback = object : android.bluetooth.le.ScanCallback() {
      override fun onScanResult(callbackType: Int, result: android.bluetooth.le.ScanResult) {
        val id = result.device.address
        val item = Arguments.createMap().apply { putString("id", id); putString("name", result.device.name ?: ""); putInt("rssi", result.rssi); putDouble("lastSeen", System.currentTimeMillis().toDouble()) }
        results[id] = item
      }
      override fun onScanFailed(errorCode: Int) { promise.reject("bluetooth_scan_failed", "Bluetooth scan failed: $errorCode") }
    }
    try {
      scanner.startScan(callback)
      Handler(Looper.getMainLooper()).postDelayed({
        try { scanner.stopScan(callback) } catch (_: SecurityException) { }
        val array = Arguments.createArray()
        results.values.forEach { array.pushMap(it) }
        promise.resolve(array)
      }, 5_000)
    } catch (error: SecurityException) {
      promise.reject("bluetooth_permission", "Nearby devices permission is required", error)
    }
  }

  @ReactMethod
  fun getCameras(promise: Promise) {
    try {
      val manager = context.getSystemService(Context.CAMERA_SERVICE) as android.hardware.camera2.CameraManager
      val cameras = Arguments.createArray()
      manager.cameraIdList.forEach { id ->
        val facing = manager.getCameraCharacteristics(id).get(android.hardware.camera2.CameraCharacteristics.LENS_FACING)
        val name = when (facing) { android.hardware.camera2.CameraCharacteristics.LENS_FACING_FRONT -> "Front camera ($id)"; android.hardware.camera2.CameraCharacteristics.LENS_FACING_BACK -> "Back camera ($id)"; else -> "External camera ($id)" }
        cameras.pushMap(Arguments.createMap().apply { putString("id", id); putString("name", name) })
      }
      promise.resolve(cameras)
    } catch (error: Exception) {
      promise.reject("camera_enumeration_error", "Unable to enumerate cameras", error)
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
    private var instance: FrameCompanionModule? = null

    fun emitStatus(status: Map<String, Any?>) {
      val map = Arguments.createMap()
      status.forEach { (key, value) -> when (value) { is String -> map.putString(key, value); is Number -> map.putDouble(key, value.toDouble()); is Boolean -> map.putBoolean(key, value) } }
      instance?.reactApplicationContext?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)?.emit("status", map)
    }

    fun preferences(context: Context) = context.getSharedPreferences(PREFS, 0)
  }
}
