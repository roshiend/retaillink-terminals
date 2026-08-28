package com.retaillink.terminal.sandbox;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import com.retaillink.terminal.driver.FeitianDriver;
import com.retaillink.terminal.driver.MyPosDriver;
import com.retaillink.terminal.driver.TerminalDriver;
import com.retaillink.terminal.driver.TerminalDriverRegistry;

public class MyPosProbeActivity extends Activity {
    private static final long POS_INFO_TIMEOUT_MS = 5000L;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final MyPosDriver myPosDriver = TerminalDriverRegistry.myPos();
    private final FeitianDriver feitianDriver = TerminalDriverRegistry.feitian();

    private TextView packageStatus;
    private TextView sdkStatus;
    private TextView driverStatus;
    private TextView feitianStatus;
    private Button readPosInfo;
    private boolean waitingForPosInfo;

    private boolean isF20Flavor() {
        return "f20".equals(BuildConfig.FLAVOR);
    }

    private final Runnable posInfoTimeout = () -> {
        if (!waitingForPosInfo) return;
        waitingForPosInfo = false;
        readPosInfo.setEnabled(true);
        setSdkStatus(
            "No POS-info response after 5 seconds. The myPOS Smart SDK is present, but the payment service/provider did not respond.",
            Color.rgb(170, 100, 20)
        );
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(buildUi());
        refreshDriverStatus();
    }

    @Override
    protected void onDestroy() {
        main.removeCallbacks(posInfoTimeout);
        super.onDestroy();
    }

    private View buildUi() {
        ScrollView scroll = new ScrollView(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(18), dp(18), dp(18), dp(28));
        root.setBackgroundColor(Color.rgb(246, 247, 249));
        scroll.addView(root);

        TextView brand = text("RETAILLINK", 14, Color.rgb(230, 105, 30));
        brand.setTypeface(null, 1);
        root.addView(brand);

        TextView title = text(isF20Flavor() ? "Terminal Driver Diagnostics" : "myPOS Smart POS Beta", 25, Color.rgb(20, 24, 30));
        title.setTypeface(null, 1);
        root.addView(title);

        TextView stage = text(
            isF20Flavor()
                ? "F20 DIAGNOSTICS — SANDBOX / myPOS / FEITIAN\nNo raw card, NFC, EMV or PIN data is read by Retaillink."
                : "APPMARKET BETA — myPOS SMART SDK\nNo raw card, CVV or PIN data is requested or stored by Retaillink.",
            13,
            Color.rgb(120, 70, 20)
        );
        stage.setPadding(0, dp(6), 0, dp(16));
        root.addView(stage);

        heading(root, "1. Driver status");
        driverStatus = text("Checking…", 15, Color.DKGRAY);
        driverStatus.setPadding(dp(8), dp(10), dp(8), dp(12));
        root.addView(driverStatus);

        Button refresh = button("REFRESH DRIVER STATUS");
        refresh.setOnClickListener(v -> refreshDriverStatus());
        root.addView(refresh);

        if (isF20Flavor()) {
            addFeitianSection(root);
        }

        heading(root, isF20Flavor() ? "3. myPOS payment package" : "2. myPOS payment package");
        packageStatus = text("Checking…", 16, Color.DKGRAY);
        packageStatus.setPadding(dp(8), dp(10), dp(8), dp(12));
        root.addView(packageStatus);

        heading(root, isF20Flavor() ? "4. myPOS Smart SDK POS information" : "3. myPOS Smart SDK POS information");
        sdkStatus = text("Not tested yet.", 15, Color.DKGRAY);
        sdkStatus.setPadding(dp(8), dp(10), dp(8), dp(12));
        root.addView(sdkStatus);

        readPosInfo = button("READ POS INFO THROUGH myPOS DRIVER");
        readPosInfo.setOnClickListener(v -> requestPosInfo());
        root.addView(readPosInfo);

        heading(root, isF20Flavor() ? "5. Retaillink sandbox" : "4. Retaillink sandbox");
        Button sandbox = button("OPEN RETAILLINK SANDBOX TERMINAL");
        sandbox.setOnClickListener(v -> startActivity(new Intent(this, MainActivity.class)));
        root.addView(sandbox);

        TextView boundary = text(
            "SECURITY BOUNDARY\nReal payment operations stay inside the vendor-certified payment stack. " +
            "This beta does not expose raw PAN, CVV, PIN or EMV data to Retaillink.",
            12,
            Color.rgb(150, 45, 45)
        );
        boundary.setTypeface(null, 1);
        boundary.setPadding(0, dp(18), 0, 0);
        root.addView(boundary);

        return scroll;
    }

    private void addFeitianSection(LinearLayout root) {
        heading(root, "2. FEITIAN FTSDK / POS Server");
        feitianStatus = text("Not tested yet.", 15, Color.DKGRAY);
        feitianStatus.setPadding(dp(8), dp(10), dp(8), dp(12));
        root.addView(feitianStatus);

        Button connectFeitian = button("CONNECT FEITIAN POS SERVER");
        connectFeitian.setOnClickListener(v -> connectFeitian());
        root.addView(connectFeitian);

        Button readFeitian = button("READ FEITIAN DEVICE INFO");
        readFeitian.setOnClickListener(v -> readFeitianInfo());
        root.addView(readFeitian);

        Button beepFeitian = button("TEST FEITIAN BUZZER");
        beepFeitian.setOnClickListener(v -> testFeitianBuzzer());
        root.addView(beepFeitian);

        Button printFeitian = button("PRINT FEITIAN TEST RECEIPT");
        printFeitian.setOnClickListener(v -> testFeitianPrinter());
        root.addView(printFeitian);
    }

    private void refreshDriverStatus() {
        boolean myPos = myPosDriver.isAvailable(this);
        TerminalDriver preferredDriver = TerminalDriverRegistry.preferredRealDriver(this);
        String preferred = preferredDriver == null ? "none" : preferredDriver.displayName();

        if (isF20Flavor()) {
            boolean feitianHardware = feitianDriver.looksLikeFeitianF20();
            boolean feitianServer = feitianDriver.hasPosServerPackage(this);
            driverStatus.setText(
                "Build: F20 diagnostics\n" +
                "Sandbox: available\n" +
                "myPOS: " + (myPos ? "available" : "unavailable") + "\n" +
                "FEITIAN F20-class hardware: " + (feitianHardware ? "detected" : "not detected") + "\n" +
                "FEITIAN FTSDK: bundled (" + FeitianDriver.SDK_VERSION + ")\n" +
                "FEITIAN POS Server: " + (feitianServer ? "package visible" : "not found") + "\n" +
                "Preferred real driver: " + preferred
            );
            refreshFeitianStatus(feitianHardware, feitianServer);
        } else {
            driverStatus.setText(
                "Build: myPOS AppMarket Beta\n" +
                "Package: " + getPackageName() + "\n" +
                "Version: " + BuildConfig.VERSION_NAME + "\n" +
                "myPOS Smart SDK: bundled\n" +
                "FEITIAN FTSDK: excluded\n" +
                "myPOS payment package: " + (myPos ? "available" : "unavailable") + "\n" +
                "Preferred real driver: " + preferred
            );
        }
        driverStatus.setTextColor(Color.rgb(40, 70, 110));

        if (!myPos) {
            packageStatus.setText("NOT FOUND — package com.mypos is not installed/visible.");
            packageStatus.setTextColor(Color.rgb(170, 40, 40));
            readPosInfo.setEnabled(false);
            setSdkStatus("The myPOS Smart SDK needs the myPOS payment application/service on the terminal.", Color.rgb(170, 100, 20));
        } else {
            packageStatus.setText("FOUND — myPOS driver can see package com.mypos.");
            packageStatus.setTextColor(Color.rgb(25, 120, 75));
            readPosInfo.setEnabled(true);
        }
    }

    private void refreshFeitianStatus(boolean hardware, boolean server) {
        if (feitianStatus == null) return;
        if (!hardware) setFeitianStatus("FTSDK is bundled, but this device does not identify as an F20.", Color.rgb(170, 100, 20));
        else if (!server) setFeitianStatus("F20 hardware detected, but com.ftpos.apiservice is not installed/visible.", Color.rgb(170, 100, 20));
        else setFeitianStatus("F20 hardware and FEITIAN POS Server package detected. Ready to bind.", Color.rgb(25, 120, 75));
    }

    private void connectFeitian() {
        setFeitianStatus("Binding to com.ftpos.apiservice…", Color.rgb(40, 70, 110));
        feitianDriver.connect(this, result -> main.post(() -> setFeitianStatus(result.message, result.success ? Color.rgb(25, 120, 75) : Color.rgb(170, 40, 40))));
    }

    private void readFeitianInfo() {
        setFeitianStatus("Connecting and reading FEITIAN device information…", Color.rgb(40, 70, 110));
        feitianDriver.getTerminalInfo(this, info -> main.post(() -> {
            if (info == null || !info.success) {
                setFeitianStatus(info == null ? "FEITIAN driver returned no information." : safe(info.details), Color.rgb(170, 40, 40));
                return;
            }
            setFeitianStatus("FEITIAN DRIVER CONNECTED\nSerial: " + printable(info.terminalId) + "\n" + info.details, Color.rgb(25, 120, 75));
        }));
    }

    private void testFeitianBuzzer() {
        setFeitianStatus("Running FEITIAN buzzer test…", Color.rgb(40, 70, 110));
        feitianDriver.beep(this, result -> main.post(() -> setFeitianStatus(result.message, result.success ? Color.rgb(25, 120, 75) : Color.rgb(170, 40, 40))));
    }

    private void testFeitianPrinter() {
        String receipt = "RETAILLINK\nFEITIAN FTSDK TEST\nSDK: " + FeitianDriver.SDK_VERSION + "\nModel: " + Build.MODEL + "\nAndroid: " + Build.VERSION.RELEASE + "\nNo payment processed.";
        setFeitianStatus("Sending diagnostic receipt to FEITIAN printer…", Color.rgb(40, 70, 110));
        feitianDriver.printReceipt(this, receipt, result -> main.post(() -> setFeitianStatus(result.message, result.success ? Color.rgb(25, 120, 75) : Color.rgb(170, 40, 40))));
    }

    private void requestPosInfo() {
        if (!myPosDriver.isAvailable(this)) { refreshDriverStatus(); return; }
        waitingForPosInfo = true;
        readPosInfo.setEnabled(false);
        setSdkStatus("Requesting POS info through MyPosDriver…", Color.rgb(40, 70, 110));
        main.removeCallbacks(posInfoTimeout);
        main.postDelayed(posInfoTimeout, POS_INFO_TIMEOUT_MS);
        myPosDriver.getTerminalInfo(this, info -> main.post(() -> handlePosInfo(info)));
    }

    private void handlePosInfo(TerminalDriver.TerminalInfo info) {
        if (!waitingForPosInfo) return;
        waitingForPosInfo = false;
        main.removeCallbacks(posInfoTimeout);
        readPosInfo.setEnabled(true);
        if (info == null || !info.success) {
            setSdkStatus(info == null ? "Driver returned no terminal information." : safe(info.details), Color.rgb(170, 100, 20));
            return;
        }
        setSdkStatus(
            "myPOS DRIVER CONNECTED\nTID: " + printable(info.terminalId) + "\nCurrency: " + printable(info.currencyName) + "\nCurrency code: " + printable(info.currencyCode),
            Color.rgb(25, 120, 75)
        );
    }

    private String safe(String value) { return value == null ? "" : value.trim(); }
    private String printable(String value) { String clean = safe(value); return clean.isEmpty() ? "(not supplied)" : clean; }
    private void setSdkStatus(String value, int color) { sdkStatus.setText(value); sdkStatus.setTextColor(color); }
    private void setFeitianStatus(String value, int color) { if (feitianStatus != null) { feitianStatus.setText(value); feitianStatus.setTextColor(color); } }

    private void heading(LinearLayout root, String value) {
        TextView heading = text(value, 18, Color.rgb(20, 24, 30));
        heading.setTypeface(null, 1);
        heading.setPadding(0, dp(18), 0, dp(4));
        root.addView(heading);
    }
    private TextView text(String value, float size, int color) { TextView view = new TextView(this); view.setText(value); view.setTextSize(size); view.setTextColor(color); return view; }
    private Button button(String value) { Button button = new Button(this); button.setText(value); button.setTextSize(14); LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, dp(54)); params.setMargins(0, dp(5), 0, dp(5)); button.setLayoutParams(params); return button; }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
}
