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

- Deny Bluetooth permission, disable Bluetooth, and confirm warning plus unavailable state.
- Register an advertising BLE device without connecting to it.
- Move target beyond RSSI threshold and wait for lost timeout; confirm target and fused presence clear.
- Calibrate vibration while idle, then vibrate the mounted device; confirm baseline and threshold diagnostics.
- Create a sudden dark-room light spike; confirm light presence without sunrise-like transitions triggering repeatedly.

## Audio And Camera

- Deny microphone permission and confirm audio detector does not retain or publish raw audio.
- Test single, double, and triple clap sequences with cooldown between sequences.
- Enable breathing experiment and verify confidence remains separate from main presence.
- Deny camera permission and confirm camera entities are unavailable or omitted.
- Select each exposed camera, change zoom, and verify motion percentage changes locally.
- Trigger motion while Bluetooth/light/vibration owner sources are away; confirm one unexpected-motion event.

## Clips And Servers

- Enable clips, trigger unexpected motion, and verify MP4 plus `.index.json` metadata.
- Set short retention, wait for scheduled cleanup, and confirm expired files disappear.
- Remove storage or fill it and confirm diagnostics expose the error without crashing service.
- Request clip and camera endpoints without Basic Auth; every request must return `401`.
- Verify clip and camera credentials are independent.
- Verify absence-motion-only camera mode returns black while owner is present and real snapshots while unexpected motion is active.
