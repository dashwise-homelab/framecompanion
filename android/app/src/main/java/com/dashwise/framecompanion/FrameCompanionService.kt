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
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import org.eclipse.paho.client.mqttv3.IMqttActionListener
import org.eclipse.paho.client.mqttv3.IMqttToken
import org.eclipse.paho.client.mqttv3.MqttAsyncClient
import org.eclipse.paho.client.mqttv3.MqttConnectOptions
import org.eclipse.paho.client.mqttv3.MqttException
import org.eclipse.paho.client.mqttv3.MqttMessage
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
  private var lightPresence = false
  private var vibrationPresence = false
  private var bluetoothPresence = false
  private var destroyed = false
  private var audioAnalyzer: AudioAnalyzer? = null
  private var clipHttpServer: LocalHttpServer? = null
  private var cameraHttpServer: LocalHttpServer? = null
  private lateinit var lightModel: LightModel
  private var cameraCapture: CameraCapture? = null
  private var cameraPresence = false
  private var cameraMotionPercent = 0.0
  private var unexpectedMotion = false
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
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val stored = FrameCompanionModule.preferences(this).getString(FrameCompanionModule.CONFIG_KEY, null)
    if (stored != null) config = JSONObject(stored)
    stopSensors()
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
      audioAnalyzer = AudioAnalyzer(this, { action -> publish("${topic("event/clap_actions")}", JSONObject().put("event_type", action).toString(), false) }, { confidence -> publishState("breathing_detected", if (confidence > 0.65) "ON" else "OFF"); FrameCompanionModule.emitStatus(mapOf("breathingConfidence" to confidence)) }).also { it.start(config.optJSONObject("audio")?.optDouble("sensitivity", 0.6) ?: 0.6) }
    }
    if (config.optJSONObject("camera")?.optBoolean("enabled", false) == true && config.optJSONObject("camera")?.optBoolean("motionDetection", true) == true) {
      val camera = config.optJSONObject("camera") ?: JSONObject()
      cameraCapture = CameraCapture(this, { percent, motion ->
        val wasUnexpected = unexpectedMotion
        cameraMotionPercent = percent
        cameraPresence = motion
        publishState("camera_presence", onOff(motion))
        val ownerAbsent = !ownerPresent()
        unexpectedMotion = ownerAbsent && motion
        publishFusedPresence()
        if (unexpectedMotion && !wasUnexpected) {
          val clips = config.optJSONObject("clips") ?: JSONObject()
          if (clips.optBoolean("enabled", false)) {
            val directory = java.io.File(clips.optString("directory").ifBlank { java.io.File(getExternalFilesDir(null) ?: filesDir, "clips").path })
            cameraCapture?.recordClip(directory, clips.optInt("postMotionSeconds", 10)) { path ->
              publish("${topic("event/unexpected_motion")}", JSONObject().put("event_type", "unexpected_motion").put("timestamp", System.currentTimeMillis()).put("clip_available", path != null).put("clip_path", path ?: JSONObject.NULL).toString(), false)
            }
          } else {
            publish("${topic("event/unexpected_motion")}", JSONObject().put("event_type", "unexpected_motion").put("timestamp", System.currentTimeMillis()).put("clip_available", false).toString(), false)
          }
        }
        publishStatus()
      }, { image -> latestSnapshot = image }).also { it.start(camera.optString("cameraId").ifBlank { null }, camera.optDouble("sensitivity", 9.0), camera.optInt("fps", 3)) }
    }
    val clipEnabled = config.optJSONObject("clipServer")?.optBoolean("enabled", false) == true
    val cameraServerEnabled = config.optJSONObject("cameraServer")?.optBoolean("enabled", false) == true
    if (clipEnabled) clipHttpServer = LocalHttpServer(this).also { server -> server.start(config, { unexpectedMotion }, { latestSnapshot }, "clips") }
    if (cameraServerEnabled) cameraHttpServer = LocalHttpServer(this).also { server -> server.start(config, { config.optJSONObject("cameraServer")?.optString("mode") == "always" || unexpectedMotion }, { latestSnapshot }, "camera") }
    if (config.optJSONObject("mqtt")?.optBoolean("enabled", false) == true) connectMqtt()
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
        vibrationPresence = debounced("vibration", motionEnergy > vibration.optDouble("tolerance", 0.2), vibrationPresence, vibration.optLong("activationMs", 500), vibration.optLong("clearDelayMs", 5_000))
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
        override fun onSuccess(asyncActionToken: IMqttToken?) { publishDiscovery(); publishState("mqtt_connection", "connected"); publishStatus() }
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
    val entities = arrayOf("main_presence", "bluetooth_presence", "light_presence", "vibration_presence", "camera_presence", "unexpected_motion", "breathing_detected", "ambient_light", "vibration_level", "presence_sources", "mqtt_connection", "last_presence_source", "last_presence_change", "camera_service", "clip_storage_usage")
    entities.forEach { id ->
      if ((!hasLight && (id == "light_presence" || id == "ambient_light")) || (!hasVibration && id == "vibration_presence" || !hasVibration && id == "vibration_level") || (!hasCamera && (id == "camera_presence" || id == "unexpected_motion" || id == "camera_service")) || (!hasMicrophone && id == "breathing_detected")) return@forEach
      val component = if (id.endsWith("presence") || id == "unexpected_motion" || id == "breathing_detected") "binary_sensor" else "sensor"
      val payload = JSONObject().apply { put("name", id.replace('_', ' ')); put("unique_id", "framecompanion_${deviceId}_$id"); put("state_topic", topic("state/$id")); put("availability_topic", topic("availability")); put("payload_available", "online"); put("payload_not_available", "offline"); put("device", device); if (id == "ambient_light") put("unit_of_measurement", "lx"); if (component == "binary_sensor") { put("payload_on", "ON"); put("payload_off", "OFF") } }
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
    val presence = config.optJSONObject("presence") ?: JSONObject()
    val enabled = presence.optJSONArray("enabledSources") ?: JSONArray()
    val active = JSONArray()
    var main = false
    for (index in 0 until enabled.length()) {
      val source = enabled.optString(index)
      val present = when (source) { "bluetooth" -> bluetoothPresence; "light" -> lightPresence; "vibration" -> vibrationPresence; "camera" -> cameraPresence && config.optJSONObject("camera")?.optBoolean("useAsPresence", false) == true; else -> false }
      if (present) { main = true; active.put(source) }
    }
    publishState("main_presence", onOff(main))
    publishState("presence_sources", active.toString())
    publishState("unexpected_motion", onOff(unexpectedMotion))
  }

  private fun debounced(source: String, next: Boolean, stable: Boolean, activationMs: Long, clearMs: Long): Boolean {
    if (next == stable) { debounceSince.remove(source); debounceValue.remove(source); return stable }
    if (debounceValue[source] != next) { debounceValue[source] = next; debounceSince[source] = System.currentTimeMillis() }
    val held = System.currentTimeMillis() - (debounceSince[source] ?: System.currentTimeMillis())
    return if (held >= if (next) activationMs else clearMs) next else stable
  }

  private fun ownerPresent(): Boolean {
    val presence = config.optJSONObject("presence") ?: JSONObject()
    val sources = presence.optJSONArray("ownerAbsenceSources") ?: JSONArray()
    for (index in 0 until sources.length()) {
      when (sources.optString(index)) { "bluetooth" -> if (bluetoothPresence) return true; "light" -> if (lightPresence) return true; "vibration" -> if (vibrationPresence) return true }
    }
    return false
  }

  private fun publishState(entity: String, value: String) { publish(topic("state/$entity"), value, true) }
  private fun publish(topic: String, value: String, retained: Boolean) { try { if (mqtt?.isConnected == true) mqtt?.publish(topic, MqttMessage(value.toByteArray()).apply { qos = 1; isRetained = retained }) } catch (_: Exception) { } }
  private fun topic(suffix: String) = "${config.optJSONObject("mqtt")?.optString("topicRoot", "framecompanion")}/$suffix"
  private fun safeId(value: String) = value.lowercase().replace(Regex("[^a-z0-9]+"), "_").trim('_').ifBlank { "target" }
  private fun onOff(value: Boolean) = if (value) "ON" else "OFF"

  private fun publishStatus(state: String? = null, error: String? = null) {
    FrameCompanionModule.emitStatus(mapOf("mqttState" to (state ?: if (mqtt?.isConnected == true) "connected" else "disconnected"), "ambientLightLux" to lightLux, "vibrationLevel" to motionEnergy, "cameraMotionPercent" to cameraMotionPercent, "cameraPresence" to cameraPresence, "bluetoothPresence" to bluetoothPresence, "lightPresence" to lightPresence, "vibrationPresence" to vibrationPresence, "lastError" to error))
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
