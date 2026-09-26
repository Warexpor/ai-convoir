package com.aiconvoir.app

import android.graphics.Color
import android.os.Bundle
import android.view.View
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // Dark bars with light icons, whatever the system theme: the app is dark-only.
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
      navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
    )
    super.onCreate(savedInstanceState)
    window.decorView.setBackgroundColor(APP_BG)

    // targetSdk 35+ forces edge-to-edge, and the WebView does not reliably
    // expose env(safe-area-inset-*). Without this the top bar sits under the
    // status bar, the composer under the gesture bar, and the keyboard covers
    // the composer. Pad the content root by bars, cutout and IME instead.
    val root = findViewById<View>(android.R.id.content)
    root.setBackgroundColor(APP_BG)
    ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
      WindowInsetsCompat.CONSUMED
    }
  }

  private companion object {
    // Matches the app's lacquer background so bar areas blend in.
    val APP_BG = Color.parseColor("#050505")
  }
}
