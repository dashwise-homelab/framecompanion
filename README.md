# Dashwise Frame Companion
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