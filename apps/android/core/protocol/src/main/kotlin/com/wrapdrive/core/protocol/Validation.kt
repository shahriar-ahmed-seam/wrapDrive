package com.wrapdrive.core.protocol

/** A single validation failure, naming the field and the reason. */
data class ValidationError(val field: String, val message: String)

/** The outcome of validating a message. */
sealed interface ValidationResult {
    val isValid: Boolean

    data object Valid : ValidationResult {
        override val isValid: Boolean = true
    }

    data class Invalid(val errors: List<ValidationError>) : ValidationResult {
        override val isValid: Boolean = false
    }
}

/**
 * Validation for WrapDrive protocol messages (Kotlin port).
 *
 * Mirrors the TypeScript validators: non-empty alias <= 64 chars, port in
 * [1024, 65535], non-empty fingerprint, valid capability bounds. Each failure
 * names the offending field.
 */
object Validation {
    fun validateDeviceInfo(info: DeviceInfo): ValidationResult {
        val errors = mutableListOf<ValidationError>()

        if (info.alias.isEmpty()) {
            errors += ValidationError("alias", "alias must not be empty")
        } else if (info.alias.length > WrapDriveProtocol.MAX_ALIAS_LENGTH) {
            errors +=
                ValidationError(
                    "alias",
                    "alias must be at most ${WrapDriveProtocol.MAX_ALIAS_LENGTH} characters",
                )
        }

        if (info.port < WrapDriveProtocol.MIN_PORT || info.port > WrapDriveProtocol.MAX_PORT) {
            errors +=
                ValidationError(
                    "port",
                    "port must be within [${WrapDriveProtocol.MIN_PORT}, ${WrapDriveProtocol.MAX_PORT}]",
                )
        }

        if (info.fingerprint.isEmpty()) {
            errors += ValidationError("fingerprint", "fingerprint must not be empty")
        }

        return if (errors.isEmpty()) ValidationResult.Valid else ValidationResult.Invalid(errors)
    }

    fun validateCapabilities(caps: Capabilities): ValidationResult {
        val errors = mutableListOf<ValidationError>()

        if (caps.appProtocol != WrapDriveProtocol.APP_PROTOCOL) {
            errors +=
                ValidationError("appProtocol", "appProtocol must be '${WrapDriveProtocol.APP_PROTOCOL}'")
        }

        if (caps.minChunkSize <= 0) {
            errors += ValidationError("minChunkSize", "minChunkSize must be a positive integer")
        }

        if (caps.maxChunkSize <= 0) {
            errors += ValidationError("maxChunkSize", "maxChunkSize must be a positive integer")
        }

        if (caps.minChunkSize > 0 && caps.maxChunkSize > 0 && caps.minChunkSize > caps.maxChunkSize) {
            errors += ValidationError("minChunkSize", "minChunkSize must not exceed maxChunkSize")
        }

        if (caps.maxParallelConnections < 1) {
            errors +=
                ValidationError("maxParallelConnections", "maxParallelConnections must be >= 1")
        }

        return if (errors.isEmpty()) ValidationResult.Valid else ValidationResult.Invalid(errors)
    }
}
