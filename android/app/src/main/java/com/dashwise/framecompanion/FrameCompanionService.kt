package com.dashwise.framecompanion

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.bluetooth.BluetoothAdapter
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import org.eclipse.paho.client.mqttv3.IMqttActionListener
import org.eclipse.paho.client.mqttv3.IMqttDeliveryToken
import org.eclipse.paho.client.mqttv3.IMqttToken
import org.eclipse.paho.client.mqttv3.MqttAsyncClient
import org.eclipse.paho.client.mqttv3.MqttConnectOptions
import org.eclipse.paho.client.mqttv3.MqttException
import org.eclipse.paho.client.mqttv3.MqttMessage
import org.eclipse.paho.client.mqttv3.MqttCallbackExtended
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import kotlin.math.abs
import kotlin.math.sqrt

class FrameCompanionService : Service(), SensorEventListener {
  private val handler = Handler(Looper.getMainLooper())
  private var mqtt: MqttAsyncClient? = null
  private var config = JSONObject()
  private var sensorManager: SensorManager? = null
  private var bleScanner: BluetoothLeScanner? = null
  private var scanCallback: ScanCallback? = null
  private var lightLux = 0.0
  private var motionEnergy = 0.0
  private var vibrationBaseline = 0.0
  private var vibrationCalibrationSum = 0.0
  private var vibrationCalibrationCount = 0
  private var lightPresence = false
  private var vibrationPresence = false
  private var bluetoothPresence = false
  private var destroyed = false
  private var audioAnalyzer: AudioAnalyzer? = null
  private var clipHttpServer: LocalHttpServer? = null
  private var cameraHttpServer: LocalHttpServer? = null
  private var clipStore: ClipStore? = null
  private lateinit var lightModel: LightModel
  private var cameraCapture: CameraCapture? = null
  private var cameraPresence = false
  private var cameraMotionPercent = 0.0
  private var unexpectedMotion = false
  private var displayOn = true
  private var volumePercent = 0.0
  private var brightnessPercent = 0.0
  private var autoBrightness = false
  private lateinit var presenceFusion: PresenceFusion
  private val debounceSince = mutableMapOf<String, Long>()
  private val debounceValue = mutableMapOf<String, Boolean>()
  private var lastBleSeen = mutableMapOf<String, Long>()
  private var lastRssi = mutableMapOf<String, Double>()

  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
    startForeground(NOTIFICATION_ID, notification("Smart-room sensing active"))
    sensorManager = getSystemService(Context.SENSOR_SERVICE) as SensorManager
    lightModel = LightModel(this)
    vibrationBaseline = FrameCompanionModule.preferences(this).getFloat(FrameCompanionModule.VIBRATION_BASELINE_KEY, 0f).toDouble()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val stored = FrameCompanionModule.preferences(this).getString(FrameCompanionModule.CONFIG_KEY, null)
    if (stored != null) config = JSONObject(stored)
    displayOn = FrameCompanionModule.preferences(this).getBoolean(FrameCompanionModule.DISPLAY_ON_KEY, true)
    presenceFusion = PresenceFusion(
      config.optJSONObject("presence")?.optJSONArray("enabledSources").toStringSet(),
      config.optJSONObject("presence")?.optJSONArray("ownerAbsenceSources").toStringSet(),
      config.optJSONObject("presence")?.optLong("debounceMs", 3_000L) ?: 3_000L,
    )
    stopSensors()
    scheduleSystemState()
    audioAnalyzer?.stop()
    audioAnalyzer = null
    cameraCapture?.stop()
    cameraCapture = null
    cameraPresence = false
    unexpectedMotion = false
    if (config.optBoolean("light", false) || config.optJSONObject("light")?.optBoolean("enabled", false) == true) startLight()
    if (config.optJSONObject("vibration")?.optBoolean("enabled", false) == true) startMotion()
    if (config.optJSONObject("bluetooth")?.optBoolean("enabled", false) == true) startBluetooth()
    if (config.optJSONObject("audio")?.optBoolean("enabled", false) == true) {
      val audio = config.optJSONObject("audio") ?: JSONObject()
      audioAnalyzer = AudioAnalyzer(this, { action -> publish("${topic("event/clap_actions")}", JSONObject().put("event_type", action).toString(), false) }, { confidence -> publishState("breathing_detected", if (confidence > 0.65) "ON" else "OFF"); FrameCompanionModule.emitStatus(mapOf("breathingConfidence" to confidence)) }, { energy -> FrameCompanionModule.emitStatus(mapOf("audioEnergy" to energy)) }).also { it.start(audio.optDouble("sensitivity", 0.6), audio.optBoolean("clapDetection", true), audio.optBoolean("breathingExperiment", false), if (audio.has("inputDeviceId")) audio.optInt("inputDeviceId") else null) }
    }
    val clipsConfig = config.optJSONObject("clips") ?: JSONObject()
    val clipEnabled = config.optJSONObject("clipServer")?.optBoolean("enabled", false) == true
    val cameraServerEnabled = config.optJSONObject("cameraServer")?.optBoolean("enabled", false) == true
    if (clipsConfig.optBoolean("enabled", false) || clipEnabled) {
      val directory = java.io.File(clipsConfig.optString("directory").ifBlank { java.io.File(getExternalFilesDir(null) ?: filesDir, "clips").path })
      clipStore = ClipStore(directory, clipsConfig.optDouble("retentionValue", 1.0), clipsConfig.optString("retentionUnit", "days")).also { it.cleanup() }
      publishState("clip_storage_usage", clipStore?.usage().toString())
      FrameCompanionModule.emitStatus(mapOf("clipStorageUsage" to clipStore?.usage()))
      clipStore?.lastError?.let { publishStatus(error = it) }
      scheduleClipCleanup()
    } else clipStore = null
    if (config.optJSONObject("camera")?.optBoolean("enabled", false) == true && config.optJSONObject("camera")?.optBoolean("motionDetection", true) == true) {
      val camera = config.optJSONObject("camera") ?: JSONObject()
      cameraCapture = CameraCapture(this, { percent, motion ->
        val wasUnexpected = unexpectedMotion
        cameraMotionPercent = percent
        cameraPresence = debounced("camera", motion, cameraPresence, 300, 1_000)
        publishState("camera_presence", onOff(cameraPresence))
        val ownerAbsent = !ownerPresent()
        unexpectedMotion = ownerAbsent && cameraPresence
        publishFusedPresence()
        if (unexpectedMotion && !wasUnexpected) {
          if (clipsConfig.optBoolean("enabled", false)) {
            val directory = java.io.File(clipsConfig.optString("directory").ifBlank { java.io.File(getExternalFilesDir(null) ?: filesDir, "clips").path })
            cameraCapture?.recordClip(directory, clipsConfig.optInt("postMotionSeconds", 10)) { path ->
              val file = path?.let { java.io.File(it) }
              val metadata = file?.takeIf { it.isFile }?.let { clipStore?.register(it, "unexpected_motion") }
              if (metadata == null) publishStatus(error = "Unable to save unexpected-motion clip")
              publishState("clip_storage_usage", clipStore?.usage().toString())
              FrameCompanionModule.emitStatus(mapOf("clipStorageUsage" to clipStore?.usage()))
              clipStore?.lastError?.let { publishStatus(error = it) }
              publish("${topic("event/unexpected_motion")}", JSONObject().put("event_type", "unexpected_motion").put("timestamp", System.currentTimeMillis()).put("clip_available", metadata != null).put("clip_id", metadata?.optString("id") ?: JSONObject.NULL).put("clip_path", path ?: JSONObject.NULL).toString(), false)
            }
          } else {
            publish("${topic("event/unexpected_motion")}", JSONObject().put("event_type", "unexpected_motion").put("timestamp", System.currentTimeMillis()).put("clip_available", false).toString(), false)
          }
        }
        publishStatus()
      }, { image -> latestSnapshot = image }).also { it.start(camera.optString("cameraId").ifBlank { null }, camera.optDouble("sensitivity", 9.0), safeCameraFps(camera.optInt("fps", 3)), camera.optDouble("zoom", 1.0)) }
    }
    if (clipEnabled) clipHttpServer = LocalHttpServer(this).also { server -> server.start(config, { unexpectedMotion }, { latestSnapshot }, "clips") }
    if (cameraServerEnabled) cameraHttpServer = LocalHttpServer(this).also { server -> server.start(config, { config.optJSONObject("cameraServer")?.optString("mode") == "always" || unexpectedMotion }, { latestSnapshot }, "camera") }
    if (config.optJSONObject("mqtt")?.optBoolean("enabled", false) == true) connectMqtt()
    publishSystemState()
    publishStatus()
    return START_STICKY
  }

  override fun onDestroy() {
    destroyed = true
    stopSensors()
    audioAnalyzer?.stop()
    audioAnalyzer = null
    clipHttpServer?.stop()
    cameraHttpServer?.stop()
    clipStore = null
    clipHttpServer = null
    cameraHttpServer = null
    try { mqtt?.disconnect() } catch (_: Exception) { }
    mqtt = null
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onSensorChanged(event: SensorEvent) {
    when (event.sensor.type) {
      Sensor.TYPE_LIGHT -> {
        lightLux = event.values.firstOrNull()?.toDouble() ?: 0.0
        val light = config.optJSONObject("light") ?: JSONObject()
        val baseline = lightModel.expected(System.currentTimeMillis(), lightLux)
        val lightSpike = lightLux - baseline >= light.optDouble("spikeDeltaLux", 25.0) && lightLux >= baseline * (1 + light.optDouble("spikePercent", 100.0) / 100)
        if (!lightSpike) lightModel.observe(System.currentTimeMillis(), lightLux)
        lightPresence = debounced("light", lightSpike, lightPresence, light.optLong("activationMs", 1_000), light.optLong("activationMs", 1_000))
        publishState("ambient_light", lightLux.toString())
        publishState("light_presence", onOff(lightPresence))
        publishFusedPresence()
      }
      Sensor.TYPE_ACCELEROMETER, Sensor.TYPE_GYROSCOPE -> {
        val magnitude = sqrt(event.values.fold(0f) { sum, value -> sum + value * value }.toDouble())
        motionEnergy = (motionEnergy * 0.85) + (abs(magnitude - if (event.sensor.type == Sensor.TYPE_ACCELEROMETER) 9.81 else 0.0) * 0.15)
        val vibration = config.optJSONObject("vibration") ?: JSONObject()
        val calibrationUntil = FrameCompanionModule.preferences(this).getLong(FrameCompanionModule.VIBRATION_CALIBRATION_UNTIL, 0L)
        if (calibrationUntil > System.currentTimeMillis()) {
          vibrationCalibrationSum += motionEnergy
          vibrationCalibrationCount += 1
          vibrationBaseline = if (vibrationCalibrationCount == 0) 0.0 else vibrationCalibrationSum / vibrationCalibrationCount
        } else if (calibrationUntil > 0L && vibrationCalibrationCount > 0) {
          vibrationBaseline = vibrationCalibrationSum / vibrationCalibrationCount
          FrameCompanionModule.preferences(this).edit().putFloat(FrameCompanionModule.VIBRATION_BASELINE_KEY, vibrationBaseline.toFloat()).remove(FrameCompanionModule.VIBRATION_CALIBRATION_UNTIL).apply()
          vibrationCalibrationSum = 0.0
          vibrationCalibrationCount = 0
        }
        val threshold = if (vibrationBaseline > 0) vibrationBaseline + vibration.optDouble("tolerance", 0.2) else vibration.optDouble("tolerance", 0.2)
        vibrationPresence = debounced("vibration", motionEnergy > threshold, vibrationPresence, vibration.optLong("activationMs", 500), vibration.optLong("clearDelayMs", 5_000))
        publishState("vibration_level", "%.4f".format(motionEnergy))
        publishState("vibration_presence", onOff(vibrationPresence))
        publishFusedPresence()
      }
    }
    publishStatus()
  }

  override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

  private fun startLight() {
    sensorManager?.getDefaultSensor(Sensor.TYPE_LIGHT)?.let { sensorManager?.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL) }
  }

  private fun startMotion() {
    val sensor = sensorManager?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) ?: sensorManager?.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
    sensor?.let { sensorManager?.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) }
  }

  private fun startBluetooth() {
    if (Build.VERSION.SDK_INT >= 31 && ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) return
    val adapter = BluetoothAdapter.getDefaultAdapter() ?: return
    bleScanner = adapter.bluetoothLeScanner
    scanCallback = object : ScanCallback() {
      override fun onScanResult(callbackType: Int, result: ScanResult) {
        val id = result.device.address
        lastBleSeen[id] = System.currentTimeMillis()
        val previous = lastRssi[id]
        lastRssi[id] = if (previous == null) result.rssi.toDouble() else previous * 0.65 + result.rssi * 0.35
        evaluateBluetooth()
      }
    }
    try { bleScanner?.startScan(scanCallback) } catch (_: SecurityException) { }
    handler.postDelayed({ stopBluetooth(); evaluateBluetooth(); if (!destroyed) startBluetooth() }, config.optJSONObject("bluetooth")?.optLong("scanIntervalMs", 10_000L) ?: 10_000L)
  }

  private fun evaluateBluetooth() {
    val now = System.currentTimeMillis()
    val devices = config.optJSONObject("bluetooth")?.optJSONArray("devices") ?: JSONArray()
    bluetoothPresence = false
    for (index in 0 until devices.length()) {
      val device = devices.optJSONObject(index) ?: continue
      val id = device.optString("id")
      val seen = lastBleSeen[id] ?: 0
      val rssi = lastRssi[id] ?: -200.0
      val present = now - seen <= device.optLong("lostTimeoutMs", 60_000) && rssi >= device.optDouble("minimumRssi", -85.0)
      bluetoothPresence = bluetoothPresence || present
      publishState("bluetooth_rssi_${safeId(id)}", "%.1f".format(rssi))
      publishState("bluetooth_${safeId(id)}_presence", onOff(present))
    }
    publishState("bluetooth_presence", onOff(bluetoothPresence))
    publishFusedPresence()
  }

  private fun stopBluetooth() {
    try { scanCallback?.let { callback -> bleScanner?.stopScan(callback) } } catch (_: SecurityException) { }
    scanCallback = null
  }

  private fun stopSensors() {
    sensorManager?.unregisterListener(this)
    stopBluetooth()
    handler.removeCallbacksAndMessages(null)
  }

  private fun connectMqtt() {
    val mqttConfig = config.optJSONObject("mqtt") ?: return
    val host = mqttConfig.optString("host")
    if (host.isBlank()) return
    if (mqtt?.isConnected == true) return
    try { mqtt?.close() } catch (_: Exception) { }
    val scheme = if (mqttConfig.optBoolean("tlsEnabled", false)) "ssl" else "tcp"
    val uri = "$scheme://$host:${mqttConfig.optInt("port", 1883)}"
    val clientId = mqttConfig.optString("clientId", "framecompanion-${UUID.randomUUID()}")
    try {
      mqtt = MqttAsyncClient(uri, clientId, MemoryPersistence())
      mqtt?.setCallback(object : MqttCallbackExtended {
        override fun connectComplete(reconnect: Boolean, serverURI: String?) {
          try { mqtt?.subscribe(topic("command/#"), 1) } catch (_: Exception) { }
          publishSystemState()
          publishDiscovery()
          publishState("mqtt_connection", "connected")
          publishStatus("connected")
        }
        override fun connectionLost(cause: Throwable?) { publishStatus("disconnected", cause?.message) }
        override fun messageArrived(topic: String?, message: MqttMessage?) {
          val value = message?.payload?.toString(Charsets.UTF_8)?.trim() ?: return
          when (topic) {
            this@FrameCompanionService.topic("command/volume") -> setVolume(value.toDoubleOrNull() ?: return)
            this@FrameCompanionService.topic("command/brightness") -> setBrightness(value.toDoubleOrNull() ?: return)
            this@FrameCompanionService.topic("command/auto_brightness") -> setAutoBrightness(value.equals("ON", true) || value == "1" || value.equals("true", true))
            this@FrameCompanionService.topic("command/display") -> setDisplay(value.equals("ON", true) || value == "1" || value.equals("true", true))
          }
        }
        override fun deliveryComplete(token: IMqttDeliveryToken?) = Unit
      })
      val options = MqttConnectOptions().apply {
        isCleanSession = false
        isAutomaticReconnect = true
        connectionTimeout = 10
        keepAliveInterval = 30
        setWill(topic("availability"), "offline".toByteArray(), 1, true)
        if (mqttConfig.optBoolean("authEnabled", false)) {
          userName = mqttConfig.optString("username")
          val passwordRef = mqttConfig.optString("passwordSecretRef")
          password = SecureSecretsModule.readSecret(this@FrameCompanionService, passwordRef)?.toCharArray()
        }
      }
      mqtt?.connect(options, null, object : IMqttActionListener {
        override fun onSuccess(asyncActionToken: IMqttToken?) { try { mqtt?.subscribe(topic("command/#"), 1) } catch (_: Exception) { }; publishSystemState(); publishDiscovery(); publishState("mqtt_connection", "connected"); publishStatus() }
        override fun onFailure(asyncActionToken: IMqttToken?, exception: Throwable?) { publishStatus("error", exception?.message) }
      })
    } catch (error: MqttException) { publishStatus("error", error.message) }
  }

  private fun publishDiscovery() {
    val mqttConfig = config.optJSONObject("mqtt") ?: return
    val deviceId = safeId(mqttConfig.optString("clientId", "framecompanion"))
    val device = JSONObject().apply { put("identifiers", JSONArray().put("framecompanion_$deviceId")); put("name", config.optString("deviceName", "FrameCompanion")); put("manufacturer", "Dashwise"); put("model", "FrameCompanion") }
    val sensors = getSystemService(Context.SENSOR_SERVICE) as SensorManager
    val hasLight = sensors.getDefaultSensor(Sensor.TYPE_LIGHT) != null
    val hasVibration = sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) != null || sensors.getDefaultSensor(Sensor.TYPE_GYROSCOPE) != null
    val hasCamera = packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY) && ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
    val hasMicrophone = packageManager.hasSystemFeature(PackageManager.FEATURE_MICROPHONE) && ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
    val discoveryTopics = mutableSetOf<String>()
    val entities = arrayOf("main_presence", "bluetooth_presence", "light_presence", "vibration_presence", "camera_presence", "unexpected_motion", "breathing_detected", "ambient_light", "battery_percentage", "brightness", "brightness_control", "vibration_level", "volume", "volume_control", "display", "auto_brightness", "presence_sources", "mqtt_connection", "last_presence_source", "last_presence_change", "camera_service", "clip_storage_usage")
    entities.forEach { id ->
      if ((!hasLight && (id == "light_presence" || id == "ambient_light")) || (!hasVibration && id == "vibration_presence" || !hasVibration && id == "vibration_level") || (!hasCamera && (id == "camera_presence" || id == "unexpected_motion" || id == "camera_service")) || (!hasMicrophone && id == "breathing_detected")) return@forEach
      val component = when {
        id == "volume_control" || id == "brightness_control" -> "number"
        id == "display" || id == "auto_brightness" -> "switch"
        id.endsWith("presence") || id == "unexpected_motion" || id == "breathing_detected" -> "binary_sensor"
        else -> "sensor"
      }
      val payload = JSONObject().apply {
        put("name", id.replace('_', ' ')); put("unique_id", "framecompanion_${deviceId}_$id"); put("state_topic", topic("state/${when (id) { "volume_control" -> "volume"; "brightness_control" -> "brightness"; else -> id }}")); put("availability_topic", topic("availability")); put("payload_available", "online"); put("payload_not_available", "offline"); put("device", device)
        if (id == "ambient_light") put("unit_of_measurement", "lx")
        if (id == "battery_percentage" || id == "volume") put("unit_of_measurement", "%")
        if (id == "brightness" || id == "brightness_control") put("unit_of_measurement", "%")
        if (id == "volume_control") { put("command_topic", topic("command/volume")); put("min", 0); put("max", 100); put("step", 1); put("unit_of_measurement", "%") }
        if (id == "brightness_control") { put("command_topic", topic("command/brightness")); put("min", 0); put("max", 100); put("step", 1); put("unit_of_measurement", "%") }
        if (id == "display") put("command_topic", topic("command/display"))
        if (id == "auto_brightness") put("command_topic", topic("command/auto_brightness"))
        if (component == "binary_sensor" || component == "switch") { put("payload_on", "ON"); put("payload_off", "OFF") }
      }
      val discoveryTopic = "homeassistant/$component/framecompanion_${deviceId}_$id/config"
      discoveryTopics.add(discoveryTopic)
      publish(discoveryTopic, payload.toString(), true)
    }
    arrayOf("clap_actions" to "clap_actions", "unexpected_motion_event" to "unexpected_motion").forEach { (id, event) ->
      val eventTypes = if (event == "clap_actions") JSONArray().put("single_clap").put("double_clap").put("triple_clap") else JSONArray().put("unexpected_motion")
      val payload = JSONObject().apply { put("name", id.replace('_', ' ')); put("unique_id", "framecompanion_${deviceId}_$id"); put("state_topic", topic("event/$event")); put("value_template", "{{ value_json.event_type }}"); put("event_types", eventTypes); put("availability_topic", topic("availability")); put("device", device) }
      val discoveryTopic = "homeassistant/event/framecompanion_${deviceId}_$id/config"
      discoveryTopics.add(discoveryTopic)
      publish(discoveryTopic, payload.toString(), true)
    }
    val targets = config.optJSONObject("bluetooth")?.optJSONArray("devices") ?: JSONArray()
    for (index in 0 until targets.length()) {
      val target = targets.optJSONObject(index) ?: continue
      val id = safeId(target.optString("id"))
      val targetEntities = arrayOf("bluetooth_rssi_$id" to "sensor", "bluetooth_${id}_presence" to "binary_sensor")
      targetEntities.forEach { (entity, component) ->
        val payload = JSONObject().apply { put("name", "${target.optString("name", id)} ${if (component == "sensor") "RSSI" else "Presence"}"); put("unique_id", "framecompanion_${deviceId}_$entity"); put("state_topic", topic("state/$entity")); put("availability_topic", topic("availability")); put("device", device); if (component == "sensor") put("unit_of_measurement", "dBm") else { put("payload_on", "ON"); put("payload_off", "OFF") } }
        val discoveryTopic = "homeassistant/$component/framecompanion_${deviceId}_$entity/config"
        discoveryTopics.add(discoveryTopic)
        publish(discoveryTopic, payload.toString(), true)
      }
    }
    val oldTopics = try { JSONArray(FrameCompanionModule.preferences(this).getString(DISCOVERY_TOPICS_KEY, "[]")) } catch (_: Exception) { JSONArray() }
    for (index in 0 until oldTopics.length()) {
      val old = oldTopics.optString(index)
      if (!discoveryTopics.contains(old)) publish(old, "", true)
    }
    FrameCompanionModule.preferences(this).edit().putString(DISCOVERY_TOPICS_KEY, JSONArray(discoveryTopics.toList()).toString()).apply()
    publish(topic("availability"), "online", true)
  }

  private fun publishFusedPresence() {
    var result = presenceFusion.update("bluetooth", bluetoothPresence)
    result = presenceFusion.update("light", lightPresence)
    result = presenceFusion.update("vibration", vibrationPresence)
    result = presenceFusion.update("camera", cameraPresence && config.optJSONObject("camera")?.optBoolean("useAsPresence", false) == true)
    publishState("main_presence", onOff(result.mainPresent))
    publishState("presence_sources", JSONArray(result.activeSources).toString())
    result.lastSource?.let { publishState("last_presence_source", it) }
    result.transitionAt?.let { publishState("last_presence_change", java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", java.util.Locale.US).format(java.util.Date(it))) }
    publishState("unexpected_motion", onOff(unexpectedMotion))
  }

  private fun debounced(source: String, next: Boolean, stable: Boolean, activationMs: Long, clearMs: Long): Boolean {
    if (next == stable) { debounceSince.remove(source); debounceValue.remove(source); return stable }
    if (debounceValue[source] != next) { debounceValue[source] = next; debounceSince[source] = System.currentTimeMillis() }
    val held = System.currentTimeMillis() - (debounceSince[source] ?: System.currentTimeMillis())
    return if (held >= if (next) activationMs else clearMs) next else stable
  }

  private fun scheduleClipCleanup() {
    handler.postDelayed({
      clipStore?.cleanup()
      clipStore?.let { publishState("clip_storage_usage", it.usage().toString()) }
      if (!destroyed) scheduleClipCleanup()
    }, 6 * 60 * 60 * 1_000L)
  }

  private fun safeCameraFps(requested: Int): Int {
    if (Build.VERSION.SDK_INT < 29) return requested
    val thermal = (getSystemService(Context.POWER_SERVICE) as android.os.PowerManager).currentThermalStatus
    return if (thermal >= android.os.PowerManager.THERMAL_STATUS_SEVERE) 1 else requested
  }

  private fun ownerPresent(): Boolean {
    return presenceFusion.ownerPresent()
  }

  private fun org.json.JSONArray?.toStringSet(): Set<String> = buildSet {
    if (this@toStringSet == null) return@buildSet
    for (index in 0 until this@toStringSet!!.length()) add(this@toStringSet!!.optString(index))
  }

  private fun publishState(entity: String, value: String) { publish(topic("state/$entity"), value, true) }
  private fun publish(topic: String, value: String, retained: Boolean) { try { if (mqtt?.isConnected == true) mqtt?.publish(topic, MqttMessage(value.toByteArray()).apply { qos = 1; isRetained = retained }) } catch (_: Exception) { } }
  private fun topic(suffix: String) = "${config.optJSONObject("mqtt")?.optString("topicRoot", "framecompanion")}/$suffix"
  private fun safeId(value: String) = value.lowercase().replace(Regex("[^a-z0-9]+"), "_").trim('_').ifBlank { "target" }
  private fun onOff(value: Boolean) = if (value) "ON" else "OFF"

  private fun publishStatus(state: String? = null, error: String? = null) {
    val calibrationUntil = FrameCompanionModule.preferences(this).getLong(FrameCompanionModule.VIBRATION_CALIBRATION_UNTIL, 0L)
    val tolerance = config.optJSONObject("vibration")?.optDouble("tolerance", 0.2) ?: 0.2
    val battery = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
    val batteryLevel = battery?.getIntExtra("level", -1) ?: -1
    val batteryScale = battery?.getIntExtra("scale", 100) ?: 100
    val thermal = if (Build.VERSION.SDK_INT >= 29) (getSystemService(Context.POWER_SERVICE) as android.os.PowerManager).currentThermalStatus else -1
    val displayAdmin = (getSystemService(Context.DEVICE_POLICY_SERVICE) as android.app.admin.DevicePolicyManager).isAdminActive(android.content.ComponentName(this, DisplayAdminReceiver::class.java))
    val canWrite = Build.VERSION.SDK_INT < 23 || Settings.System.canWrite(this)
    FrameCompanionModule.emitStatus(mapOf("mqttState" to (state ?: if (mqtt?.isConnected == true) "connected" else "disconnected"), "ambientLightLux" to lightLux, "vibrationLevel" to motionEnergy, "vibrationBaseline" to vibrationBaseline, "vibrationThreshold" to (if (vibrationBaseline > 0) vibrationBaseline + tolerance else tolerance), "vibrationCalibrating" to (calibrationUntil > System.currentTimeMillis()), "cameraMotionPercent" to cameraMotionPercent, "cameraPresence" to cameraPresence, "bluetoothPresence" to bluetoothPresence, "lightPresence" to lightPresence, "vibrationPresence" to vibrationPresence, "batteryPercent" to if (batteryLevel >= 0) batteryLevel * 100.0 / batteryScale else null, "volumePercent" to volumePercent, "brightnessPercent" to brightnessPercent, "autoBrightness" to autoBrightness, "canWriteSettings" to canWrite, "displayOn" to displayOn, "displayAdminActive" to displayAdmin, "thermalStatus" to thermal, "lastError" to error))
  }

  private fun scheduleSystemState() {
    handler.postDelayed({
      publishSystemState()
      publishStatus()
      if (!destroyed) scheduleSystemState()
    }, 10_000L)
  }

  private fun publishSystemState() {
    val audio = getSystemService(Context.AUDIO_SERVICE) as android.media.AudioManager
    val maximum = audio.getStreamMaxVolume(android.media.AudioManager.STREAM_MUSIC).coerceAtLeast(1)
    volumePercent = audio.getStreamVolume(android.media.AudioManager.STREAM_MUSIC) * 100.0 / maximum
    publishState("volume", "%.0f".format(volumePercent))
    brightnessPercent = Settings.System.getInt(contentResolver, Settings.System.SCREEN_BRIGHTNESS, 0) * 100.0 / 255.0
    autoBrightness = Settings.System.getInt(contentResolver, Settings.System.SCREEN_BRIGHTNESS_MODE, Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL) == Settings.System.SCREEN_BRIGHTNESS_MODE_AUTOMATIC
    publishState("brightness", "%.0f".format(brightnessPercent))
    publishState("auto_brightness", onOff(autoBrightness))
    publishState("display", onOff(displayOn))
    val battery = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
    val level = battery?.getIntExtra("level", -1) ?: -1
    val scale = battery?.getIntExtra("scale", 100) ?: 100
    if (level >= 0) publishState("battery_percentage", "%.1f".format(level * 100.0 / scale))
  }

  private fun setVolume(percent: Double) {
    val audio = getSystemService(Context.AUDIO_SERVICE) as android.media.AudioManager
    val maximum = audio.getStreamMaxVolume(android.media.AudioManager.STREAM_MUSIC).coerceAtLeast(1)
    val value = percent.coerceIn(0.0, 100.0)
    audio.setStreamVolume(android.media.AudioManager.STREAM_MUSIC, (maximum * value / 100.0).toInt(), 0)
    publishSystemState()
    publishStatus()
  }

  private fun setBrightness(percent: Double) {
    if (Build.VERSION.SDK_INT >= 23 && !Settings.System.canWrite(this)) { publishStatus(error = "Android write-settings permission required for brightness"); return }
    val value = percent.coerceIn(0.0, 100.0)
    Settings.System.putInt(contentResolver, Settings.System.SCREEN_BRIGHTNESS_MODE, Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL)
    Settings.System.putInt(contentResolver, Settings.System.SCREEN_BRIGHTNESS, (255 * value / 100.0).toInt())
    publishSystemState()
    publishStatus()
  }

  private fun setAutoBrightness(on: Boolean) {
    if (Build.VERSION.SDK_INT >= 23 && !Settings.System.canWrite(this)) { publishStatus(error = "Android write-settings permission required for auto brightness"); return }
    Settings.System.putInt(contentResolver, Settings.System.SCREEN_BRIGHTNESS_MODE, if (on) Settings.System.SCREEN_BRIGHTNESS_MODE_AUTOMATIC else Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL)
    publishSystemState()
    publishStatus()
  }

  private fun setDisplay(on: Boolean) {
    displayOn = on
    FrameCompanionModule.preferences(this).edit().putBoolean(FrameCompanionModule.DISPLAY_ON_KEY, on).apply()
    val devicePolicy = getSystemService(Context.DEVICE_POLICY_SERVICE) as android.app.admin.DevicePolicyManager
    val admin = devicePolicy.isAdminActive(android.content.ComponentName(this, DisplayAdminReceiver::class.java))
    try {
      if (!on && admin) devicePolicy.lockNow()
      if (on) {
        val power = getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
        @Suppress("DEPRECATION")
        val wake = power.newWakeLock(android.os.PowerManager.SCREEN_BRIGHT_WAKE_LOCK or android.os.PowerManager.ACQUIRE_CAUSES_WAKEUP or android.os.PowerManager.ON_AFTER_RELEASE, "FrameCompanion:display")
        wake.acquire(3_000L)
        wake.release()
      }
    } catch (error: SecurityException) { publishStatus(error = error.message ?: "Display power control denied") }
    publishState("display", onOff(on))
    FrameCompanionModule.emitStatus(mapOf("displayOn" to on, "displayAdminActive" to admin))
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= 26) getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(CHANNEL_ID, "FrameCompanion sensing", NotificationManager.IMPORTANCE_LOW))
  }

  private fun notification(text: String): Notification = NotificationCompat.Builder(this, CHANNEL_ID).setContentTitle("FrameCompanion").setContentText(text).setSmallIcon(android.R.drawable.ic_menu_info_details).setOngoing(true).build()

  companion object {
    private const val CHANNEL_ID = "framecompanion.sensing"
    private const val NOTIFICATION_ID = 401
    private const val DISCOVERY_TOPICS_KEY = "discovery_topics"
    private var latestSnapshot: ByteArray = LocalHttpServer.blackJpeg()

    fun statusMap(context: Context): com.facebook.react.bridge.WritableMap {
      val result = com.facebook.react.bridge.Arguments.createMap()
      result.putString("mqttState", "unknown")
      return result
    }

    fun testMqtt(context: Context, config: JSONObject, promise: com.facebook.react.bridge.Promise) {
      val mqttConfig = config.optJSONObject("mqtt") ?: JSONObject()
      val host = mqttConfig.optString("host")
      if (host.isBlank()) { promise.reject("mqtt_invalid", "Broker host is required"); return }
      val scheme = if (mqttConfig.optBoolean("tlsEnabled", false)) "ssl" else "tcp"
      try {
        val client = MqttAsyncClient("$scheme://$host:${mqttConfig.optInt("port", 1883)}", "framecompanion-test-${UUID.randomUUID()}", MemoryPersistence())
        val options = MqttConnectOptions().apply {
          if (mqttConfig.optBoolean("authEnabled", false)) {
            userName = mqttConfig.optString("username")
            password = SecureSecretsModule.readSecret(context, mqttConfig.optString("passwordSecretRef"))?.toCharArray()
          }
        }
        client.connect(options, null, object : IMqttActionListener {
          override fun onSuccess(asyncActionToken: IMqttToken?) { try { client.disconnect(); client.close() } catch (_: Exception) { }; promise.resolve("Connection successful") }
          override fun onFailure(asyncActionToken: IMqttToken?, exception: Throwable?) { promise.reject("mqtt_connection_failed", exception?.message ?: "Connection failed") }
        })
      } catch (error: Exception) { promise.reject("mqtt_connection_failed", error.message, error) }
    }
  }
}
