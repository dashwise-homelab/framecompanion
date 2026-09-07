# Android Manual Test Matrix

Run on a physical Android device. Emulator sensor results are not representative.

## Service And MQTT

- Enable MQTT with a reachable broker and confirm `Connected` in Settings.
- Confirm one FrameCompanion device appears through MQTT Discovery.
- Restart broker and verify offline/online availability and discovery republish.
- Disable MQTT and confirm the foreground service stops when no other feature is enabled.
- Reboot device with sensing enabled and confirm the persistent notification and service recovery.
- Confirm battery percentage and volume entities update after charging, hardware volume changes, and the polling interval.
- Send MQTT volume commands and verify Android music volume changes and Home Assistant slider state follows.
- Grant write-settings access, send brightness slider commands, and verify brightness plus auto-brightness state updates.
- Send display `OFF`; verify device-admin lock when enabled or native black-screen fallback otherwise. Send `ON` and verify wake/frame restoration.

## Presence

- Calibrate vibration while idle, then vibrate the mounted device; confirm baseline and threshold diagnostics.
- Create a sudden dark-room light spike; confirm light presence without sunrise-like transitions triggering repeatedly.

## Audio

- Deny microphone permission and confirm audio detector does not retain or publish raw audio.
- Test single, double, and triple clap sequences with cooldown between sequences.
