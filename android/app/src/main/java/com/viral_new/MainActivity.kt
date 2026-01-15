package com.viral_new

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.ReactApplication
import com.facebook.react.ReactInstanceManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.ArrayList

class MainActivity : ReactActivity() {

  // ✅ RN hazır değilken kaçırmamak için
  private var pendingSharePayload: WritableMap? = null

  override fun getMainComponentName(): String = "viral_new"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
    DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    handleIncomingShareIntent(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    handleIncomingShareIntent(intent)
  }

  override fun onResume() {
    super.onResume()
    val p = pendingSharePayload
    if (p != null) {
      if (emitToReactNative(p)) {
        pendingSharePayload = null
        // ✅ aynı intent tekrar tekrar işlenmesin
        try { intent?.replaceExtras(Bundle()) } catch (_: Exception) {}
      }
    }
  }

  private fun handleIncomingShareIntent(i: Intent?) {
    if (i == null) return

    val action = i.action ?: return
    if (action != Intent.ACTION_SEND && action != Intent.ACTION_SEND_MULTIPLE) return

    val payload = Arguments.createMap()
    payload.putString("action", action)
    payload.putString("mimeType", i.type)

    // text
    val sharedText = i.getStringExtra(Intent.EXTRA_TEXT)
    if (!sharedText.isNullOrBlank()) payload.putString("text", sharedText)

    // single stream
    val stream: Uri? = getStreamUri(i)
    if (stream != null) payload.putString("uri", stream.toString())

    // multiple streams
    val streams: ArrayList<Uri>? = getStreamUriList(i)
    if (streams != null && streams.isNotEmpty()) {
      val arr = Arguments.createArray()
      for (u in streams) arr.pushString(u.toString())
      payload.putArray("uris", arr)
    }

    val hasAnything = payload.hasKey("text") || payload.hasKey("uri") || payload.hasKey("uris")
    if (!hasAnything) return

    // ✅ RN hazırsa direkt, değilse pending
    if (!emitToReactNative(payload)) {
      pendingSharePayload = payload
    } else {
      // ✅ aynı intent tekrar tekrar işlenmesin
      try { i.replaceExtras(Bundle()) } catch (_: Exception) {}
    }
  }

  private fun emitToReactNative(payload: WritableMap): Boolean {
    return try {
      val app = application as ReactApplication
      val reactInstanceManager: ReactInstanceManager = app.reactNativeHost.reactInstanceManager
      val ctx = reactInstanceManager.currentReactContext
      if (ctx == null) {
        false
      } else {
        ctx
          .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit("viral_share_intent", payload)
        true
      }
    } catch (_: Exception) {
      false
    }
  }

  // --- Android 13+ uyumlu parcelable okuma ---

  private fun getStreamUri(i: Intent): Uri? {
    return try {
      if (Build.VERSION.SDK_INT >= 33) {
        i.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
      } else {
        @Suppress("DEPRECATION")
        i.getParcelableExtra(Intent.EXTRA_STREAM) as? Uri
      }
    } catch (_: Exception) {
      null
    }
  }

  private fun getStreamUriList(i: Intent): ArrayList<Uri>? {
    return try {
      if (Build.VERSION.SDK_INT >= 33) {
        i.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
      } else {
        @Suppress("DEPRECATION")
        i.getParcelableArrayListExtra(Intent.EXTRA_STREAM)
      }
    } catch (_: Exception) {
      null
    }
  }
}
