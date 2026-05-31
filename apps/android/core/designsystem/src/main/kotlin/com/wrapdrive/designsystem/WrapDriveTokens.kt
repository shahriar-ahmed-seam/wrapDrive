package com.wrapdrive.designsystem

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * WrapDrive design tokens for Jetpack Compose.
 *
 * Generated from packages/design-system/src/tokens.json by
 * scripts/generate-android-theme.mjs. Do not edit by hand; change the shared
 * tokens and re-run the generator so every platform stays in sync.
 */
object WrapDriveTokens {
  object Brand {
    val primary: Color = Color(0xFF5B8DEF)
    val primaryHover: Color = Color(0xFF4F7FE0)
    val primaryActive: Color = Color(0xFF4571CC)
    val onPrimary: Color = Color(0xFFFFFFFF)
    val accent: Color = Color(0xFF6FE3C2)
    val onAccent: Color = Color(0xFF06231C)
  }

  object Dark {
    val background: Color = Color(0xFF0E1117)
    val surface: Color = Color(0xFF161B22)
    val surfaceRaised: Color = Color(0xFF1C232D)
    val surfaceOverlay: Color = Color(0xFF232C38)
    val border: Color = Color(0xFF2A3340)
    val textPrimary: Color = Color(0xFFE6EDF3)
    val textSecondary: Color = Color(0xFF9DA7B3)
    val textMuted: Color = Color(0xFF6B7682)
  }

  object Light {
    val background: Color = Color(0xFFF5F7FA)
    val surface: Color = Color(0xFFFFFFFF)
    val surfaceRaised: Color = Color(0xFFFFFFFF)
    val surfaceOverlay: Color = Color(0xFFEEF1F5)
    val border: Color = Color(0xFFD8DEE6)
    val textPrimary: Color = Color(0xFF1A1F26)
    val textSecondary: Color = Color(0xFF4A5563)
    val textMuted: Color = Color(0xFF7A858F)
  }

  object Status {
    val success: Color = Color(0xFF3FB950)
    val warning: Color = Color(0xFFD29922)
    val danger: Color = Color(0xFFF85149)
    val info: Color = Color(0xFF58A6FF)
  }

  object Spacing {
    val none: Dp = 0.dp
    val xxs: Dp = 2.dp
    val xs: Dp = 4.dp
    val sm: Dp = 8.dp
    val md: Dp = 12.dp
    val lg: Dp = 16.dp
    val xl: Dp = 24.dp
    val xxl: Dp = 32.dp
    val xxxl: Dp = 48.dp
  }

  object Radius {
    val none: Dp = 0.dp
    val sm: Dp = 6.dp
    val md: Dp = 10.dp
    val lg: Dp = 16.dp
    val xl: Dp = 24.dp
    val pill: Dp = 999.dp
  }

  object FontSize {
    const val caption: Int = 12
    const val body: Int = 14
    const val bodyLarge: Int = 16
    const val title: Int = 20
    const val headline: Int = 28
    const val display: Int = 36
  }

  object MotionDuration {
    const val instant: Int = 80
    const val fast: Int = 150
    const val normal: Int = 240
    const val slow: Int = 400
  }
}
