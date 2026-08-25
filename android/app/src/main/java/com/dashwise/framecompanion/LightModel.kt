package com.dashwise.framecompanion

import android.content.Context
import org.json.JSONObject
import java.util.Calendar

class LightModel(private val context: Context) {
  private val preferences = context.getSharedPreferences(PREFS, 0)

  fun expected(at: Long, fallback: Double): Double {
    val values = read()
    val minute = minuteOfDay(at)
    val candidates = (-2..2).map { ((minute / BUCKET_MINUTES + it + BUCKETS) % BUCKETS).toString() }
      .mapNotNull { values.optJSONObject(it)?.optDouble("mean") }
    return if (candidates.isEmpty()) fallback else candidates.average()
  }

  fun observe(at: Long, lux: Double) {
    val values = read()
    val key = (minuteOfDay(at) / BUCKET_MINUTES).toString()
    val current = values.optJSONObject(key) ?: JSONObject().apply { put("mean", lux); put("count", 0) }
    val count = current.optInt("count", 0)
    val alpha = if (count < 10) 0.2 else 0.02
    current.put("mean", current.optDouble("mean", lux) * (1 - alpha) + lux * alpha)
    current.put("count", count + 1)
    values.put(key, current)
    preferences.edit().putString(KEY, values.toString()).apply()
  }

  fun reset() { preferences.edit().remove(KEY).apply() }

  private fun read() = try { JSONObject(preferences.getString(KEY, "{}") ?: "{}") } catch (_: Exception) { JSONObject() }
  private fun minuteOfDay(at: Long): Int { val calendar = Calendar.getInstance().apply { timeInMillis = at }; return calendar.get(Calendar.HOUR_OF_DAY) * 60 + calendar.get(Calendar.MINUTE) }

  companion object {
    private const val PREFS = "framecompanion.light-model"
    private const val KEY = "buckets"
    private const val BUCKET_MINUTES = 15
    private const val BUCKETS = 96
  }
}
