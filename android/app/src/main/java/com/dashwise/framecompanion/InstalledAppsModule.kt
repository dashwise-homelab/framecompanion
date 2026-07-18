package com.dashwise.framecompanion

import android.content.Intent
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class InstalledAppsModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "InstalledApps"

  @ReactMethod
  fun getInstalledApps(promise: Promise) {
    try {
      val packageManager = reactContext.packageManager
      val launcherIntent = Intent(Intent.ACTION_MAIN, null).apply {
        addCategory(Intent.CATEGORY_LAUNCHER)
      }
      val activities = packageManager.queryIntentActivities(launcherIntent, 0)
      val apps = Arguments.createArray()

      activities
        .distinctBy { it.activityInfo.packageName }
        .sortedBy { it.loadLabel(packageManager).toString().lowercase() }
        .forEach { resolveInfo ->
          val app = Arguments.createMap()
          app.putString("packageName", resolveInfo.activityInfo.packageName)
          app.putString("label", resolveInfo.loadLabel(packageManager).toString())
          apps.pushMap(app)
        }

      promise.resolve(apps)
    } catch (error: Exception) {
      promise.reject("installed_apps_error", "Unable to load installed apps", error)
    }
  }

  @ReactMethod
  fun openApp(packageName: String, promise: Promise) {
    val intent = reactContext.packageManager.getLaunchIntentForPackage(packageName)
    if (intent == null) {
      promise.reject("app_not_launchable", "No launch intent found for $packageName")
      return
    }

    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    reactContext.startActivity(intent)
    promise.resolve(null)
  }

}
