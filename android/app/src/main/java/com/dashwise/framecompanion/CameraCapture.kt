package com.dashwise.framecompanion

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.ImageFormat
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.media.Image
import android.media.ImageReader
import android.media.MediaRecorder
import android.os.Handler
import android.os.HandlerThread
import android.util.Range
import androidx.core.content.ContextCompat
import kotlin.math.abs

class CameraCapture(private val context: Context, private val onMotion: (Double, Boolean) -> Unit, private val onSnapshot: (ByteArray) -> Unit) {
  private val thread = HandlerThread("framecompanion-camera")
  private var handler: Handler? = null
  private var device: CameraDevice? = null
  private var session: CameraCaptureSession? = null
  private var reader: ImageReader? = null
  private var previous: ByteArray? = null
  private var sensitivity = 9.0
  private var selectedId: String? = null
  private var recorder: MediaRecorder? = null
  private var recording = false
  private var zoom = 1.0
  private var analysisIntervalMs = 333L
  private var lastAnalysisAt = 0L
  private var cropRegion: android.graphics.Rect? = null

  fun start(cameraId: String?, sensitivity: Double, fps: Int, zoom: Double) {
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) return
    this.sensitivity = sensitivity
    selectedId = cameraId
    this.zoom = zoom.coerceAtLeast(1.0)
    analysisIntervalMs = 1_000L / fps.coerceIn(1, 15)
    thread.start()
    handler = Handler(thread.looper)
    val manager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
    val availableIds = manager.cameraIdList
    val id = cameraId?.takeIf { availableIds.contains(it) } ?: availableIds.firstOrNull() ?: return
    try {
      val characteristics = manager.getCameraCharacteristics(id)
      val sensor = characteristics.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE)
      val maximumZoom = characteristics.get(CameraCharacteristics.SCALER_AVAILABLE_MAX_DIGITAL_ZOOM) ?: 1f
      cropRegion = sensor?.let { crop(it, this.zoom.coerceAtMost(maximumZoom.toDouble())) }
    } catch (_: Exception) { cropRegion = null }
    reader = ImageReader.newInstance(320, 240, ImageFormat.YUV_420_888, 2).also { imageReader ->
      imageReader.setOnImageAvailableListener({ source ->
        source.acquireLatestImage()?.use { image -> process(image) }
      }, handler)
    }
    try {
      manager.openCamera(id, object : CameraDevice.StateCallback() {
        override fun onOpened(camera: CameraDevice) { device = camera; createSession() }
        override fun onDisconnected(camera: CameraDevice) { camera.close(); device = null }
        override fun onError(camera: CameraDevice, error: Int) { camera.close(); device = null }
      }, handler)
    } catch (_: SecurityException) { }
  }

  fun stop() {
    stopRecordingNow()
    try { session?.close(); device?.close(); reader?.close() } catch (_: Exception) { }
    session = null; device = null; reader = null; previous = null
    try { thread.quitSafely() } catch (_: Exception) { }
    handler = null
  }

  fun recordClip(directory: java.io.File, durationSeconds: Int, onComplete: (String?) -> Unit) {
    val camera = device ?: run { onComplete(null); return }
    val captureHandler = handler ?: run { onComplete(null); return }
    if (recording) return
    captureHandler.post {
      val file = java.io.File(directory, java.text.SimpleDateFormat("yyyy-MM-dd'T'HH-mm-ss", java.util.Locale.US).format(java.util.Date()) + "_unexpected-motion.mp4")
      try {
        directory.mkdirs()
        val media = MediaRecorder()
        media.setVideoSource(MediaRecorder.VideoSource.SURFACE)
        media.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
        media.setVideoEncoder(MediaRecorder.VideoEncoder.H264)
        media.setVideoSize(320, 240)
        media.setVideoFrameRate(10)
        media.setVideoEncodingBitRate(500_000)
        media.setOutputFile(file.absolutePath)
        media.prepare()
        recorder = media
        recording = true
        session?.close()
        camera.createCaptureSession(listOf(reader?.surface, media.surface).filterNotNull(), object : CameraCaptureSession.StateCallback() {
          override fun onConfigured(created: CameraCaptureSession) {
            session = created
            try {
              val request = camera.createCaptureRequest(CameraDevice.TEMPLATE_RECORD).apply { reader?.surface?.let { addTarget(it) }; addTarget(media.surface); applyCameraControls(this) }.build()
              created.setRepeatingRequest(request, null, captureHandler)
              media.start()
              captureHandler.postDelayed({ stopRecordingNow(); onComplete(if (file.exists()) file.absolutePath else null); createSession() }, durationSeconds.coerceAtLeast(1) * 1_000L)
            } catch (_: Exception) { stopRecordingNow(); onComplete(null); createSession() }
          }
          override fun onConfigureFailed(created: CameraCaptureSession) { stopRecordingNow(); onComplete(null); createSession() }
        }, captureHandler)
      } catch (_: Exception) { stopRecordingNow(); onComplete(null) }
    }
  }

  private fun createSession() {
    val camera = device ?: return
    val output = reader?.surface ?: return
    try {
      camera.createCaptureSession(listOf(output), object : CameraCaptureSession.StateCallback() {
        override fun onConfigured(created: CameraCaptureSession) {
          session = created
          try {
            val request = camera.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW).apply { addTarget(output); set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO); applyCameraControls(this) }.build()
            created.setRepeatingRequest(request, null, handler)
          } catch (_: Exception) { }
        }
        override fun onConfigureFailed(created: CameraCaptureSession) = Unit
      }, handler)
    } catch (_: Exception) { }
  }

  private fun stopRecordingNow() {
    if (!recording) return
    try { recorder?.stop() } catch (_: Exception) { }
    try { recorder?.reset(); recorder?.release() } catch (_: Exception) { }
    recorder = null
    recording = false
  }

  private fun process(image: Image) {
    val now = System.currentTimeMillis()
    if (now - lastAnalysisAt < analysisIntervalMs) return
    lastAnalysisAt = now
    val plane = image.planes.firstOrNull() ?: return
    val width = image.width
    val height = image.height
    val buffer = plane.buffer
    val rowStride = plane.rowStride
    val pixelStride = plane.pixelStride
    val luma = ByteArray(width * height)
    var outputIndex = 0
    for (y in 0 until height) {
      for (x in 0 until width) {
        val offset = y * rowStride + x * pixelStride
        if (offset < buffer.limit()) luma[outputIndex++] = buffer.get(offset)
      }
    }
    val old = previous
    previous = luma
    if (old != null) {
      var changed = 0
      for (index in luma.indices) if (abs((luma[index].toInt() and 0xff) - (old[index].toInt() and 0xff)) >= 18) changed += 1
      val percent = changed.toDouble() / luma.size * 100
      onMotion(percent, percent >= sensitivity)
    }
    onSnapshot(grayscaleJpeg(luma, width, height))
  }

  private fun applyCameraControls(builder: CaptureRequest.Builder) {
    if (android.os.Build.VERSION.SDK_INT >= 30) {
      try { builder.set(CaptureRequest.CONTROL_ZOOM_RATIO, zoom.toFloat()) } catch (_: Exception) { }
    } else cropRegion?.let { builder.set(CaptureRequest.SCALER_CROP_REGION, it) }
    try { builder.set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, Range(1, 15)) } catch (_: Exception) { }
  }

  private fun crop(sensor: android.graphics.Rect, zoom: Double): android.graphics.Rect {
    val centerX = sensor.centerX()
    val centerY = sensor.centerY()
    val width = (sensor.width() / zoom).toInt()
    val height = (sensor.height() / zoom).toInt()
    return android.graphics.Rect(centerX - width / 2, centerY - height / 2, centerX + width / 2, centerY + height / 2)
  }

  private fun grayscaleJpeg(luma: ByteArray, width: Int, height: Int): ByteArray {
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val pixels = IntArray(width * height)
    for (index in pixels.indices) { val value = luma[index].toInt() and 0xff; pixels[index] = -0x1000000 or (value shl 16) or (value shl 8) or value }
    bitmap.setPixels(pixels, 0, width, 0, 0, width, height)
    val output = java.io.ByteArrayOutputStream()
    bitmap.compress(Bitmap.CompressFormat.JPEG, 65, output)
    bitmap.recycle()
    return output.toByteArray()
  }
}
