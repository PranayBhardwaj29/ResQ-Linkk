# ResQLink Integrated Android Project

This is the first integration pass that keeps the existing ResQLink React website UI and embeds it locally in the native Android app. The native Nearby Connections implementation is retained in `app/src/main/java/com/example/resqmesh/`.

## What's connected

- The Android activity hosts the bundled React/Vite app in a WebView using `WebViewAssetLoader` (local assets, not a hosted website).
- The existing Kotlin `MeshViewModel` and `NearbyConnectionsManager` are retained as the mesh engine.
- The website navigation now includes **Offline Mesh**, with a panel for starting/stopping the mesh, viewing connected peers and sending/receiving messages through a narrow JavaScript bridge.
- Android location permission requests include coarse + fine together, as in the tested native app. The website's geolocation prompt is also bridged through Android permissions.
- The package name remains `com.example.resqmesh` so this project can replace the earlier debug build when signed with the same debug key.

## Build the web bundle first

Requirements: Node.js + npm. Internet is normally required on the first dependency install.

From this project root:

```bash
./build-web.sh
```

This runs `npm ci` in `web-source/`, builds the production bundle, then copies `dist/` into `app/src/main/assets/web/`. The small `index.html` currently in the assets folder is only a setup reminder; the script replaces it with the actual bundle.

Then open this project root in Android Studio, let Gradle sync, and run the app or choose **Build > Build APK(s)**. Use a full JDK 21 and install the Android SDK platform / build tools required by `compileSdk 36`. The project has `org.gradle.java.home` set to the JDK 21 location used in the original working native project (`/home/sanskar/.jdks/temurin-21.0.11`); change that path if this project is moved to another machine.

Debug APK output:

```text
app/build/outputs/apk/debug/app-debug.apk
```

## Test the integration

1. Install the same APK on all test phones.
2. Keep Bluetooth and Wi-Fi enabled, even while Airplane mode is on.
3. Open **Offline Mesh** on each phone and tap **Start Mesh**. Grant the requested permissions.
4. Verify that each phone shows connected peers and that a message sent from one phone appears on the other phone.
5. Close and reopen the panel and confirm it reflects the native mesh state.

## Important limitations in this first pass

This bundles the **UI** locally. It does not make every website feature offline automatically. Existing API calls to `http://localhost:3001`, relative `/api/*` sync requests, and Supabase-backed behavior still depend on an appropriate backend/configuration and may fall back or fail while the device has no internet. Online-only services such as remotely hosted fonts or external map resources may also be unavailable offline. The separate offline mesh messaging transport is native and does not rely on those services.

No APK was built as part of this workspace packaging: the current build environment does not have an Android SDK installed, and npm dependency downloads could not resolve the npm registry. The project is prepared for the build steps above, but compile/install testing remains to be done on the laptop with Android Studio.
