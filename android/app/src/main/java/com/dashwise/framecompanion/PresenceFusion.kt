package com.dashwise.framecompanion

class PresenceFusion(
  enabledSources: Set<String>,
  ownerSources: Set<String>,
  private var debounceMs: Long,
) {
  data class Result(val mainPresent: Boolean, val activeSources: List<String>, val lastSource: String?, val transitionAt: Long?)

  private var enabled = enabledSources
  private var owner = ownerSources
  private val states = mutableMapOf<String, Boolean>()
  private var mainPresent = false
  private var pendingValue: Boolean? = null
  private var pendingSince = 0L
  private var lastSource: String? = null

  fun configure(enabledSources: Set<String>, ownerSources: Set<String>, debounce: Long) {
    enabled = enabledSources
    owner = ownerSources
    debounceMs = debounce.coerceAtLeast(0)
  }

  fun update(source: String, present: Boolean, now: Long = System.currentTimeMillis()): Result {
    states[source] = present
    val active = enabled.filter { states[it] == true }
    val next = active.isNotEmpty()
    var transitionAt: Long? = null
    if (next != mainPresent) {
      if (pendingValue != next) {
        pendingValue = next
        pendingSince = now
      }
      if (now - pendingSince >= debounceMs) {
        mainPresent = next
        transitionAt = now
        pendingValue = null
        if (next) lastSource = active.lastOrNull()
      }
    } else {
      pendingValue = null
    }
    return Result(mainPresent, active, lastSource, transitionAt)
  }

  fun ownerPresent() = owner.any { states[it] == true }
}
