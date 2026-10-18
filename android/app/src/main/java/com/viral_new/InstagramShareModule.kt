package com.viral_new

import android.content.ClipData
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.net.Uri
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import android.text.TextUtils
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileOutputStream

class InstagramShareModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  companion object {
    private const val INSTAGRAM_PACKAGE = "com.instagram.android"
  }

  override fun getName(): String = "InstagramShare"

  @ReactMethod
  fun share(
    mode: String,
    title: String?,
    body: String?,
    link: String?,
    message: String?,
    promise: Promise,
  ) {
    val activity = currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "Aktif ekran bulunamadı.")
      return
    }

    try {
      when (mode.trim().lowercase()) {
        "direct" -> {
          val text = message?.trim().orEmpty().ifBlank {
            listOf(title, body, link)
              .map { it?.trim().orEmpty() }
              .filter { it.isNotBlank() }
              .joinToString("\n\n")
          }

          val intent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            setPackage(INSTAGRAM_PACKAGE)
            putExtra(Intent.EXTRA_TEXT, text)
          }
          activity.startActivity(intent)
          promise.resolve(true)
        }

        "story", "feed" -> {
          val isStory = mode.trim().equals("story", ignoreCase = true)
          val file = createShareCard(
            title = title?.trim().orEmpty(),
            body = body?.trim().orEmpty(),
            link = link?.trim().orEmpty(),
            story = isStory,
          )

          val uri: Uri = FileProvider.getUriForFile(
            reactContext,
            "${reactContext.packageName}.fileprovider",
            file,
          )

          reactContext.grantUriPermission(
            INSTAGRAM_PACKAGE,
            uri,
            Intent.FLAG_GRANT_READ_URI_PERMISSION,
          )

          if (isStory) {
            val intent = Intent("com.instagram.share.ADD_TO_STORY").apply {
              setDataAndType(uri, "image/png")
              setPackage(INSTAGRAM_PACKAGE)
              addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
              clipData = ClipData.newRawUri("Viral", uri)
            }
            activity.startActivity(intent)
          } else {
            startInstagramFeed(activity, uri, link?.trim().orEmpty())
          }

          promise.resolve(true)
        }

        else -> promise.reject("BAD_MODE", "Bilinmeyen Instagram paylaşım türü: $mode")
      }
    } catch (e: Exception) {
      promise.reject("INSTAGRAM_SHARE_FAILED", e.message ?: "Instagram paylaşımı açılamadı.", e)
    }
  }


  /**
   * Instagram paketinin image/png ACTION_SEND hedeflerini çözer ve mümkünse
   * genel "Instagram" (Feed) aktivitesini doğrudan açar. Böylece Android'in
   * Stories / Reels / Messages hedefleri arasında her seferinde farklı seçim
   * yapmasına bağlı kalmayız.
   *
   * Instagram sürümü hedef aktivite adlarını değiştirirse güvenli fallback olarak
   * önce feed-benzeri hedef, o da bulunamazsa eski setPackage davranışı kullanılır.
   */
  private fun startInstagramFeed(
    activity: android.app.Activity,
    uri: Uri,
    link: String,
  ) {
    val baseIntent = Intent(Intent.ACTION_SEND).apply {
      type = "image/png"
      setPackage(INSTAGRAM_PACKAGE)
      putExtra(Intent.EXTRA_STREAM, uri)
      if (link.isNotBlank()) {
        putExtra(Intent.EXTRA_TEXT, link)
      }
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      clipData = ClipData.newRawUri("Viral", uri)
    }

    val pm = reactContext.packageManager
    val candidates = pm
      .queryIntentActivities(baseIntent, PackageManager.MATCH_DEFAULT_ONLY)
      .filter { it.activityInfo?.packageName == INSTAGRAM_PACKAGE }

    fun labelOf(resolveInfo: android.content.pm.ResolveInfo): String =
      try {
        resolveInfo.loadLabel(pm)?.toString()?.trim().orEmpty()
      } catch (_: Exception) {
        ""
      }

    fun isNonFeedTarget(resolveInfo: android.content.pm.ResolveInfo): Boolean {
      val label = labelOf(resolveInfo).lowercase()
      val name = resolveInfo.activityInfo?.name?.lowercase().orEmpty()
      val combined = "$label $name"
      return listOf(
        "message", "messages", "direct", "reel", "reels", "story", "stories",
        "mesaj", "hikaye",
      ).any { combined.contains(it) }
    }

    val exactInstagram = candidates.firstOrNull {
      labelOf(it).equals("Instagram", ignoreCase = true)
    }

    val feedLike = candidates.firstOrNull { !isNonFeedTarget(it) }
    val chosen = exactInstagram ?: feedLike

    if (chosen?.activityInfo != null) {
      val targetedIntent = Intent(baseIntent).apply {
        component = ComponentName(
          chosen.activityInfo.packageName,
          chosen.activityInfo.name,
        )
      }
      activity.startActivity(targetedIntent)
      return
    }

    // Instagram'ın ileride activity isimlerini/etiketlerini değiştirmesi durumunda
    // mevcut çalışan davranışı koru; paylaşımı tamamen engelleme.
    activity.startActivity(baseIntent)
  }

  private fun createShareCard(title: String, body: String, link: String, story: Boolean): File {
    val width = 1080
    val height = if (story) 1920 else 1350
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)

    canvas.drawColor(Color.rgb(11, 12, 16))

    val redPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.rgb(229, 9, 20)
      style = Paint.Style.FILL
    }
    val whitePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.WHITE
      textAlign = Paint.Align.CENTER
      typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
      textSize = if (story) 104f else 92f
    }

    val logoY = if (story) 260f else 205f
    canvas.drawCircle(width / 2f, logoY, if (story) 130f else 112f, redPaint)
    canvas.drawText("V", width / 2f, logoY + 48f, whitePaint)

    whitePaint.textSize = if (story) 86f else 76f
    canvas.drawText("Viral", width / 2f, logoY + if (story) 220f else 185f, whitePaint)

    val side = 90
    var y = if (story) 610f else 485f

    val heading = title.ifBlank { "Viral Network" }
    y += drawMultilineText(
      canvas = canvas,
      text = heading,
      x = side.toFloat(),
      y = y,
      width = width - side * 2,
      textSize = if (story) 68f else 60f,
      color = Color.WHITE,
      bold = true,
      maxLines = 3,
      spacing = 1.08f,
    ) + 38f

    if (body.isNotBlank()) {
      y += drawMultilineText(
        canvas = canvas,
        text = body,
        x = side.toFloat(),
        y = y,
        width = width - side * 2,
        textSize = if (story) 50f else 46f,
        color = Color.rgb(225, 225, 230),
        bold = false,
        maxLines = if (story) 11 else 7,
        spacing = 1.18f,
      )
    }

    if (link.isNotBlank()) {
      val linkPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(255, 90, 96)
        textSize = if (story) 34f else 32f
        typeface = Typeface.create(Typeface.DEFAULT, Typeface.NORMAL)
      }
      val linkLayout = StaticLayout.Builder
        .obtain(link, 0, link.length, linkPaint, width - side * 2)
        .setAlignment(Layout.Alignment.ALIGN_CENTER)
        .setMaxLines(2)
        .setEllipsize(TextUtils.TruncateAt.END)
        .setEllipsizedWidth(width - side * 2)
        .build()

      canvas.save()
      canvas.translate(side.toFloat(), (height - if (story) 260 else 205).toFloat())
      linkLayout.draw(canvas)
      canvas.restore()
    }

    val footerPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.rgb(155, 155, 165)
      textAlign = Paint.Align.CENTER
      textSize = if (story) 30f else 28f
      typeface = Typeface.create(Typeface.DEFAULT, Typeface.NORMAL)
    }
    canvas.drawText("Created on Viral", width / 2f, (height - 92).toFloat(), footerPaint)

    val shareDir = File(reactContext.cacheDir, "shared").apply { mkdirs() }
    val file = File(shareDir, if (story) "viral_instagram_story.png" else "viral_instagram_feed.png")
    FileOutputStream(file).use { out ->
      bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
      out.flush()
    }
    bitmap.recycle()
    return file
  }

  private fun drawMultilineText(
    canvas: Canvas,
    text: String,
    x: Float,
    y: Float,
    width: Int,
    textSize: Float,
    color: Int,
    bold: Boolean,
    maxLines: Int,
    spacing: Float,
  ): Float {
    val paint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
      this.color = color
      this.textSize = textSize
      typeface = Typeface.create(Typeface.DEFAULT, if (bold) Typeface.BOLD else Typeface.NORMAL)
    }

    val layout = StaticLayout.Builder
      .obtain(text, 0, text.length, paint, width)
      .setAlignment(Layout.Alignment.ALIGN_NORMAL)
      .setIncludePad(false)
      .setLineSpacing(0f, spacing)
      .setMaxLines(maxLines)
      .setEllipsize(TextUtils.TruncateAt.END)
      .setEllipsizedWidth(width)
      .build()

    canvas.save()
    canvas.translate(x, y)
    layout.draw(canvas)
    canvas.restore()
    return layout.height.toFloat()
  }
}
