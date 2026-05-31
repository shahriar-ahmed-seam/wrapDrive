package com.wrapdrive.designsystem

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * The WrapDrive Compose theme, bound to the shared design tokens in
 * [WrapDriveTokens] (generated from `packages/design-system/src/tokens.json`).
 * Using the generated tokens keeps Android visually identical to Desktop and
 * Web.
 */
private val DarkColors =
    darkColorScheme(
        primary = WrapDriveTokens.Brand.primary,
        onPrimary = WrapDriveTokens.Brand.onPrimary,
        secondary = WrapDriveTokens.Brand.accent,
        onSecondary = WrapDriveTokens.Brand.onAccent,
        background = WrapDriveTokens.Dark.background,
        onBackground = WrapDriveTokens.Dark.textPrimary,
        surface = WrapDriveTokens.Dark.surface,
        onSurface = WrapDriveTokens.Dark.textPrimary,
        surfaceVariant = WrapDriveTokens.Dark.surfaceRaised,
        onSurfaceVariant = WrapDriveTokens.Dark.textSecondary,
        outline = WrapDriveTokens.Dark.border,
        error = WrapDriveTokens.Status.danger,
    )

private val LightColors =
    lightColorScheme(
        primary = WrapDriveTokens.Brand.primary,
        onPrimary = WrapDriveTokens.Brand.onPrimary,
        secondary = WrapDriveTokens.Brand.accent,
        onSecondary = WrapDriveTokens.Brand.onAccent,
        background = WrapDriveTokens.Light.background,
        onBackground = WrapDriveTokens.Light.textPrimary,
        surface = WrapDriveTokens.Light.surface,
        onSurface = WrapDriveTokens.Light.textPrimary,
        surfaceVariant = WrapDriveTokens.Light.surfaceOverlay,
        onSurfaceVariant = WrapDriveTokens.Light.textSecondary,
        outline = WrapDriveTokens.Light.border,
        error = WrapDriveTokens.Status.danger,
    )

private val WrapDriveTypography =
    Typography(
        displayMedium =
            TextStyle(
                fontSize = WrapDriveTokens.FontSize.display.sp,
                fontWeight = FontWeight.Bold,
            ),
        headlineMedium =
            TextStyle(
                fontSize = WrapDriveTokens.FontSize.headline.sp,
                fontWeight = FontWeight.SemiBold,
            ),
        titleLarge =
            TextStyle(
                fontSize = WrapDriveTokens.FontSize.title.sp,
                fontWeight = FontWeight.SemiBold,
            ),
        bodyLarge = TextStyle(fontSize = WrapDriveTokens.FontSize.bodyLarge.sp),
        bodyMedium = TextStyle(fontSize = WrapDriveTokens.FontSize.body.sp),
        labelSmall = TextStyle(fontSize = WrapDriveTokens.FontSize.caption.sp),
    )

/** Applies the WrapDrive Material 3 theme. Dark by default, following system. */
@Composable
fun WrapDriveTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        typography = WrapDriveTypography,
        content = content,
    )
}
