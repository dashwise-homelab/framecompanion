package com.dashwise.framecompanion

import android.content.Context
import android.util.Base64
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.File
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.concurrent.Executors

class LocalHttpServer(private val context: Context) {
  private val executor = Executors.newCachedThreadPool()
  private var server: ServerSocket? = null
  private var username = ""
  private var password = ""
  private var cameraUsername = ""
  private var cameraPassword = ""
  private var clipsDirectory = File(context.getExternalFilesDir(null) ?: context.filesDir, "clips")
  private var cameraMode = "absence-motion-only"
  private var cameraActive: () -> Boolean = { false }
  private var snapshot: () -> ByteArray = { BLACK_JPEG }
  private var cameraOnly = false
  private var clipsOnly = false

  fun start(config: org.json.JSONObject, cameraActive: () -> Boolean, snapshot: () -> ByteArray, mode: String = "auto") {
    stop()
    val clipConfig = config.optJSONObject("clipServer") ?: org.json.JSONObject()
    val cameraConfig = config.optJSONObject("cameraServer") ?: org.json.JSONObject()
    username = clipConfig.optString("username")
    password = SecureSecretsModule.readSecret(context, clipConfig.optString("passwordSecretRef")) ?: ""
    cameraUsername = cameraConfig.optString("username")
    cameraPassword = SecureSecretsModule.readSecret(context, cameraConfig.optString("passwordSecretRef")) ?: ""
    cameraMode = cameraConfig.optString("mode", "absence-motion-only")
    clipsDirectory = File(config.optJSONObject("clips")?.optString("directory") ?: clipsDirectory.path).also { it.mkdirs() }
    cleanup(config)
    this.cameraActive = cameraActive
    this.snapshot = snapshot
    cameraOnly = mode == "camera"
    clipsOnly = mode == "clips"
    val port = when {
      mode == "camera" -> cameraConfig.optInt("port", 8766)
      mode == "clips" -> clipConfig.optInt("port", 8765)
      cameraConfig.optBoolean("enabled", false) -> cameraConfig.optInt("port", 8766)
      else -> clipConfig.optInt("port", 8765)
    }
    try {
      server = ServerSocket(port, 32, java.net.InetAddress.getByName("0.0.0.0"))
      executor.execute {
        while (server?.isClosed == false) {
          try { server?.accept()?.let { socket -> executor.execute { handle(socket) } } } catch (_: Exception) { }
        }
      }
    } catch (_: Exception) {
      server = null
    }
  }

  fun stop() {
    try { server?.close() } catch (_: Exception) { }
    server = null
  }

  private fun handle(socket: Socket) {
    socket.use { client ->
      val input = BufferedInputStream(client.getInputStream())
      val output = BufferedOutputStream(client.getOutputStream())
      val request = readRequest(input) ?: return
      val path = request.substringAfter(' ').substringBefore(' ')
      val isCamera = path.startsWith("/camera/")
      val credentials = if (isCamera) Pair(cameraUsername, cameraPassword) else Pair(username, password)
      if (credentials.first.isBlank() || !authorized(request, credentials.first, credentials.second)) {
        write(output, "401 Unauthorized", "text/plain", "Authentication required".toByteArray(), mapOf("WWW-Authenticate" to "Basic realm=FrameCompanion"))
        return
      }
      when {
        !cameraOnly && (path == "/" || path == "/clips") -> write(output, "200 OK", "text/html; charset=utf-8", listing().toByteArray(StandardCharsets.UTF_8))
        !cameraOnly && path.startsWith("/clips/") -> serveClip(output, URLDecoder.decode(path.removePrefix("/clips/"), "UTF-8"))
        !clipsOnly && path == "/camera/snapshot.jpg" -> write(output, "200 OK", "image/jpeg", if (cameraMode == "always" || cameraActive()) snapshot() else BLACK_JPEG)
        !clipsOnly && path == "/camera/stream.mjpeg" -> stream(output)
        else -> write(output, "404 Not Found", "text/plain", "Not found".toByteArray())
      }
    }
  }

  private fun stream(output: BufferedOutputStream) {
    output.write("HTTP/1.1 200 OK\r\nContent-Type: multipart/x-mixed-replace; boundary=frame\r\nCache-Control: no-cache\r\n\r\n".toByteArray())
    repeat(60) {
      val frame = if (cameraMode == "always" || cameraActive()) snapshot() else BLACK_JPEG
      output.write("--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.size}\r\n\r\n".toByteArray())
      output.write(frame)
      output.write("\r\n".toByteArray())
      output.flush()
      Thread.sleep(1_000)
    }
  }

  private fun serveClip(output: BufferedOutputStream, name: String) {
    val file = File(clipsDirectory, name)
    if (!file.canonicalFile.path.startsWith(clipsDirectory.canonicalFile.path) || !file.isFile) {
      write(output, "404 Not Found", "text/plain", "Clip not found".toByteArray())
      return
    }
    write(output, "200 OK", "video/mp4", file.readBytes())
  }

  private fun listing(): String = buildString {
    append("<html><body><h1>FrameCompanion clips</h1><ul>")
    clipsDirectory.listFiles()?.filter { it.isFile }?.sortedByDescending { it.lastModified() }?.forEach { file -> append("<li><a href=\"/clips/${file.name}\">${file.name}</a> (${file.length()} bytes)</li>") }
    append("</ul></body></html>")
  }

  private fun cleanup(config: org.json.JSONObject) {
    val clips = config.optJSONObject("clips") ?: return
    val value = clips.optDouble("retentionValue", 1.0)
    val unit = clips.optString("retentionUnit", "days")
    val cutoff = System.currentTimeMillis() - (value * if (unit == "days") 86_400_000 else 3_600_000).toLong()
    clipsDirectory.listFiles()?.filter { it.isFile && it.lastModified() < cutoff }?.forEach { it.delete() }
  }

  private fun readRequest(input: BufferedInputStream): String? {
    val bytes = StringBuilder()
    var previous = ""
    while (bytes.length < 16_384) {
      val next = input.read()
      if (next < 0) return null
      bytes.append(next.toChar())
      if (previous.endsWith("\r\n") && bytes.toString().endsWith("\r\n\r\n")) break
      previous = (previous + next.toChar()).takeLast(2)
    }
    return bytes.toString()
  }

  private fun authorized(request: String, expectedUser: String, expectedPassword: String): Boolean {
    val header = request.lineSequence().firstOrNull { it.startsWith("Authorization:", true) } ?: return false
    val encoded = header.substringAfter(' ').substringAfter(' ').trim()
    val decoded = try { String(Base64.decode(encoded, Base64.DEFAULT), StandardCharsets.UTF_8) } catch (_: Exception) { return false }
    return decoded == "$expectedUser:$expectedPassword"
  }

  private fun write(output: BufferedOutputStream, status: String, contentType: String, body: ByteArray, extra: Map<String, String> = emptyMap()) {
    output.write("HTTP/1.1 $status\r\nContent-Type: $contentType\r\nContent-Length: ${body.size}\r\nConnection: close\r\n".toByteArray())
    extra.forEach { (key, value) -> output.write("$key: $value\r\n".toByteArray()) }
    output.write("\r\n".toByteArray()); output.write(body); output.flush()
  }

  companion object {
    private val BLACK_JPEG = Base64.decode("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/AP/EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEABj8Cf//Z", Base64.DEFAULT)
    fun blackJpeg() = BLACK_JPEG
  }
}
