package com.dashwise.framecompanion

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import androidx.core.content.ContextCompat
import kotlin.math.abs

class AudioAnalyzer(private val context: Context, private val onAction: (String) -> Unit, private val onSignal: (Double) -> Unit) {
  @Volatile private var running = false
  private var thread: Thread? = null

  fun start(sensitivity: Double, clapEnabled: Boolean, inputDeviceId: Int?) {
    if (running || ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) return
    val minimum = AudioRecord.getMinBufferSize(16_000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    if (minimum <= 0) return
    running = true
    thread = Thread {
      val recorder = AudioRecord(MediaRecorder.AudioSource.MIC, 16_000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, minimum * 2)
      if (inputDeviceId != null && android.os.Build.VERSION.SDK_INT >= 23) {
        context.getSystemService(Context.AUDIO_SERVICE)?.let { service ->
          (service as android.media.AudioManager).getDevices(android.media.AudioManager.GET_DEVICES_INPUTS).firstOrNull { it.id == inputDeviceId }?.let { recorder.setPreferredDevice(it) }
        }
      }
      val buffer = ShortArray(minimum)
      val candidates = mutableListOf<Long>()
      val envelope = java.util.ArrayDeque<Double>()
      var previousSample = 0
      var cooldownUntil = 0L
      try {
        recorder.startRecording()
        while (running) {
          val count = recorder.read(buffer, 0, buffer.size)
          if (count <= 0) continue
          var energy = 0.0
          var peak = 0
          var transientPeak = 0
          for (index in 0 until count) {
            val sample = buffer[index].toInt()
            val value = abs(sample)
            energy += value.toDouble() * value
            if (value > peak) peak = value
            transientPeak = maxOf(transientPeak, abs(sample - previousSample))
            previousSample = sample
          }
          val rms = kotlin.math.sqrt(energy / count) / 32_768.0
          val now = System.currentTimeMillis()
          envelope.addLast(rms)
          if (envelope.size > 192) envelope.removeFirst()
          if (clapEnabled && transientPeak / 32_768.0 > 0.35 * sensitivity.coerceIn(0.1, 1.0) && peak / 32_768.0 > 0.45 && rms > 0.02 && now >= cooldownUntil) {
            candidates.removeAll { now - it > 900 }
            candidates.add(now)
            if (now - candidates.first() >= 700 || candidates.size >= 3) {
              val action = when (candidates.size.coerceAtMost(3)) { 1 -> "single_clap"; 2 -> "double_clap"; else -> "triple_clap" }
              onAction(action)
              candidates.clear()
              cooldownUntil = now + 1_000
            }
          }
          onSignal(rms)

        }
      } catch (_: Exception) {
        // Permission, audio focus, and unavailable input are reported by capability/status UI.
      } finally {
        try { recorder.stop() } catch (_: Exception) { }
        recorder.release()
      }
    }.also { it.start() }
  }

  fun stop() {
    running = false
    thread?.interrupt()
    thread = null
  }

}
