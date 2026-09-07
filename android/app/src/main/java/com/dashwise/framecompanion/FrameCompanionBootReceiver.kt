package com.dashwise.framecompanion

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

class FrameCompanionBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    if (intent?.action != Intent.ACTION_BOOT_COMPLETED && intent?.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
    val config = FrameCompanionModule.preferences(context).getString(FrameCompanionModule.CONFIG_KEY, null) ?: return
    val json = org.json.JSONObject(config)
    val active = json.optJSONObject("mqtt")?.optBoolean("enabled", false) == true ||

      json.optJSONObject("light")?.optBoolean("enabled", false) == true ||
      json.optJSONObject("vibration")?.optBoolean("enabled", false) == true ||
      json.optJSONObject("audio")?.optBoolean("enabled", false) == true
    if (!active) return
    val serviceIntent = Intent(context, FrameCompanionService::class.java)
    if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(serviceIntent) else context.startService(serviceIntent)
  }
}
