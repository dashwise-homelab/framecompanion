package com.dashwise.framecompanion

import org.json.JSONArray
import org.json.JSONObject
import java.io.File

class ClipStore(private val directory: File, private val retentionValue: Double, private val retentionUnit: String) {
  private val indexFile = File(directory, ".index.json")
  var lastError: String? = null
    private set

  init { if (!directory.exists() && !directory.mkdirs()) lastError = "Clip directory unavailable: ${directory.path}" }

  @Synchronized
  fun cleanup(now: Long = System.currentTimeMillis()) {
    try {
      val cutoff = now - (retentionValue * if (retentionUnit == "days") 86_400_000 else 3_600_000).toLong()
      val metadata = read()
      val kept = JSONArray()
      for (index in 0 until metadata.length()) {
        val item = metadata.optJSONObject(index) ?: continue
        val path = File(item.optString("path"))
        if (path.isFile && path.lastModified() >= cutoff) kept.put(item) else path.delete()
      }
      directory.listFiles()?.filter { it.isFile && it.extension == "mp4" && it.lastModified() < cutoff }?.forEach { it.delete() }
      write(kept)
      lastError = null
    } catch (error: Exception) {
      lastError = error.message ?: "Clip cleanup failed"
    }
  }

  @Synchronized
  fun register(file: File, trigger: String): JSONObject? {
    return try {
      val item = JSONObject().apply {
        put("id", file.nameWithoutExtension)
        put("created_at", file.lastModified())
        put("ended_at", System.currentTimeMillis())
        put("trigger", trigger)
        put("size", file.length())
        put("path", file.absolutePath)
      }
      read().apply { put(item) }.also { write(it) }
      lastError = null
      item
    } catch (error: Exception) {
      lastError = error.message ?: "Clip metadata write failed"
      null
    }
  }

  @Synchronized
  fun usage(): Long = try { directory.listFiles()?.filter { it.isFile && it.extension == "mp4" }?.sumOf { it.length() } ?: 0L } catch (_: Exception) { 0L }

  private fun read() = try { JSONArray(if (indexFile.isFile) indexFile.readText() else "[]") } catch (_: Exception) { JSONArray() }
  private fun write(value: JSONArray) { indexFile.writeText(value.toString()) }
}
