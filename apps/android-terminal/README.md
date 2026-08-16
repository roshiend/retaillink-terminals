# Retaillink F20 Sandbox Terminal

Android sandbox terminal app targeting Android 10+ payment terminals, initially validated against the FEITIAN F20 / myPOS Pro F20E hardware family.

## Safety boundary

- Sandbox/test only. No real-money processing.
- Never enter real card or PIN data.
- v0.1 does not access the terminal IC/chip, NFC/contactless, magstripe, secure PIN pad, or secure element.
- Synthetic payment scenarios are built into the app.
- Hardware payment readers will only be enabled through the FEITIAN-supported payment SDK and signing/deployment process.

## First F20 installation test

FEITIAN documents two development installation routes for F20 devices: ADB with USB debugging, or installing an APK copied to SD/OTG storage. A myPOS-branded production firmware may disable Developer Options and may require vendor signing or STORM deployment.

1. Download the `retaillink-f20-sandbox-terminal` artifact from the `Android Terminal APK` GitHub Actions workflow.
2. Extract `app-debug.apk` on a PC.
3. Copy `app-debug.apk` to a USB flash drive connected through a USB-C OTG adapter (or accessible SD/TF storage if your terminal exposes it).
4. On the F20, open its Files/File Manager app and tap `app-debug.apk`.
5. If Android offers `Allow from this source`, enable it only for the file manager used for this test, then install.
6. If the terminal reports `Blocked by administrator`, refuses unknown applications without an override, or rejects the package because of signing policy, stop. Do not attempt to bypass secure boot/device policy. Use FEITIAN signing/STORM/development firmware instead.
7. Open **Retaillink Sandbox Terminal**. Leave `Connected sandbox API mode` OFF for the first test and try Approve, Decline, and 3DS simulator buttons.
8. Use `Copy device information` and record Manufacturer, Brand, Model, Device, Product, Android API level, and Build. This is useful before integrating the FEITIAN payment SDK.

## Connected sandbox mode

The app can call the Retaillink sandbox API using a restricted `sk_test_...` key with `payments:read` + `payments:write` scopes.

For a temporary LAN development test, the debug APK permits HTTP and can use a URL such as:

```text
http://192.168.1.50:3001
```

The computer and F20 must be on the same LAN and the API must be reachable on that interface. External/deployed sandbox environments should use HTTPS.

## Build locally

Requires JDK 17, Android SDK API 37, Build Tools 36.0.0, and Gradle 9.5.0.

```bash
cd apps/android-terminal
gradle :app:assembleDebug
```

APK output:

```text
app/build/outputs/apk/debug/app-debug.apk
```
