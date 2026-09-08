# Dashwise Frame Companion
If you want something stable, use https://github.com/RushB-fr/freekiosk

Dashwise Frame Companion is a WebView for Dashwise's Smart Frame. In addition to the webview it also doubles as a default launcher.

Disclaimer: The companion is vibecoded

## Screens
### Onboarding
In the onboarding process, enter your dashwise instances root url. From there on, you will be redirected to the webview.
### WebView
Display a native fullscreen webview using BASE_URL/frame?closeAction=urlParam

When the path includes the param closeActionTriggered with a truish val (true/1/any string which isnt 0 or false), navigate to AppView.

### AppView
From any other screen the AppView can be opened by drawing an L shape on the screen.

AppView shows a vertical list of apps installed on a users device as rows with icon and title.
Long pressing on the rows should open a dialog with two option: pin (pins to the top of appview list), app info (goes to settings) 

## Tech Stack
Expo + React Native

## Smart Presence

Android builds include an optional `FrameCompanionService` foreground service. Enable features from `AppView -> Settings`; the service restores its configuration after reboot, keeps MQTT connected with an offline LWT, and publishes retained Home Assistant MQTT Discovery entities under `framecompanion/<client-id>/...`.

Supported local capabilities are detected at runtime. Light and vibration presence detection plus clap processing stay on the device; only derived values and actions are published to MQTT. Bluetooth tracking, breathing analysis, camera capture, recording, and camera/clip servers are not included.

Home Assistant Discovery also exposes battery percentage, Android music-volume and screen-brightness number sliders, plus auto-brightness and display switches. Volume, battery, brightness, and auto-brightness state refresh automatically. Brightness changes require Android write-settings permission. Display `OFF` uses Android Device Admin lock when granted, otherwise FrameCompanion renders a native black screen; no admin permission is required for the fallback.

## Android Build

Use a development/native Android build for the service and custom modules:

```sh
npm install
npm run typecheck
npm test
npm run android
```

Runtime permissions are requested only when a related feature is enabled. If hardware or permission is unavailable, its detector and discovery entities are omitted or shown unavailable instead of being simulated.

See `docs/android-manual-test.md` for broker, permission, sensor, and reboot validation flows.
