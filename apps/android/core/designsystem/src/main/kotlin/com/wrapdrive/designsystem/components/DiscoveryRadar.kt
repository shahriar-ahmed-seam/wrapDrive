package com.wrapdrive.designsystem.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * An animated discovery radar: concentric rings with an expanding pulse,
 * shown while the app is scanning for peers. Purely decorative; peer markers
 * are layered on top by the screen.
 */
@Composable
fun DiscoveryRadar(
    modifier: Modifier = Modifier,
    diameter: Dp = 240.dp,
) {
    val transition = rememberInfiniteTransition(label = "radar")
    val pulse by
        transition.animateFloat(
            initialValue = 0f,
            targetValue = 1f,
            animationSpec =
                infiniteRepeatable(
                    animation = tween(durationMillis = 2400, easing = LinearEasing),
                    repeatMode = RepeatMode.Restart,
                ),
            label = "pulse",
        )

    val ring = MaterialTheme.colorScheme.outline
    val accent = MaterialTheme.colorScheme.primary

    Canvas(modifier = modifier.size(diameter)) {
        val maxRadius = size.minDimension / 2
        // Static concentric rings.
        for (i in 1..3) {
            drawCircle(
                color = ring,
                radius = maxRadius * (i / 3f),
                style = androidx.compose.ui.graphics.drawscope.Stroke(width = 2f),
            )
        }
        // Expanding pulse that fades as it grows.
        drawCircle(
            color = accent.copy(alpha = (1f - pulse) * 0.5f),
            radius = maxRadius * pulse,
            style = androidx.compose.ui.graphics.drawscope.Stroke(width = 4f),
        )
    }
}
