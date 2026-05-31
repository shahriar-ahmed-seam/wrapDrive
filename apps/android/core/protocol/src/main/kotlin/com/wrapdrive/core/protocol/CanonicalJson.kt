package com.wrapdrive.core.protocol

/**
 * A minimal canonical JSON writer matching JavaScript's `JSON.stringify`
 * output for the value shapes WrapDrive uses.
 *
 * It emits no insignificant whitespace, escapes exactly the characters
 * `JSON.stringify` escapes (quote, backslash, and control characters below
 * 0x20, with the short forms for \b \t \n \f \r), and leaves non-ASCII
 * characters as raw UTF-8. Object key order is the caller's insertion order, so
 * serializers add keys in the canonical order and pre-sort map keys. This is
 * what keeps Kotlin output byte-identical to the TypeScript serializer.
 */
internal class JsonWriter {
    private val sb = StringBuilder()

    fun beginObject(): JsonWriter {
        sb.append('{')
        return this
    }

    fun endObject(): JsonWriter {
        sb.append('}')
        return this
    }

    fun beginArray(): JsonWriter {
        sb.append('[')
        return this
    }

    fun endArray(): JsonWriter {
        sb.append(']')
        return this
    }

    fun comma(): JsonWriter {
        sb.append(',')
        return this
    }

    fun colon(): JsonWriter {
        sb.append(':')
        return this
    }

    fun nullValue(): JsonWriter {
        sb.append("null")
        return this
    }

    fun value(boolean: Boolean): JsonWriter {
        sb.append(if (boolean) "true" else "false")
        return this
    }

    fun value(number: Long): JsonWriter {
        sb.append(number.toString())
        return this
    }

    fun value(number: Int): JsonWriter {
        sb.append(number.toString())
        return this
    }

    /** Write a JSON string literal with JS-compatible escaping. */
    fun value(string: String): JsonWriter {
        sb.append('"')
        for (ch in string) {
            when (ch) {
                '"' -> sb.append("\\\"")
                '\\' -> sb.append("\\\\")
                '\b' -> sb.append("\\b")
                '\u000C' -> sb.append("\\f")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                '\t' -> sb.append("\\t")
                else ->
                    if (ch < '\u0020') {
                        sb.append("\\u")
                        sb.append(ch.code.toString(16).padStart(4, '0'))
                    } else {
                        sb.append(ch)
                    }
            }
        }
        sb.append('"')
        return this
    }

    /** Write a string-or-null field value. */
    fun valueOrNull(string: String?): JsonWriter = if (string == null) nullValue() else value(string)

    override fun toString(): String = sb.toString()
}
