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

    private final Runnable posInfoTimeout = () -> {
        if (!waitingForPosInfo) return;
        waitingForPosInfo = false;
        readPosInfo.setEnabled(true);
        setSdkStatus(
            "No POS-info response after 5 seconds. The myPOS driver is compiled into Retaillink, but the " +
            "payment service/provider is not responding on this firmware.",
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

        TextView title = text("Terminal Driver Diagnostics", 25, Color.rgb(20, 24, 30));
        title.setTypeface(null, 1);
        root.addView(title);

        TextView stage = text(
            "FTSDK STAGE 1 — SANDBOX / myPOS / FEITIAN\nNo raw card, NFC, EMV or PIN data is read by Retaillink.",
            13,
            Color.rgb(120, 70, 20)
        );
        stage.setPadding(0, dp(6), 0, dp(16));
        root.addView(stage);

        heading(root, "1. Driver registry");
        driverStatus = text("Checking…", 15, Color.DKGRAY);
        driverStatus.setPadding(dp(8), dp(10), dp(8), dp(12));
        root.addView(driverStatus);

        Button refresh = button("REFRESH DRIVER STATUS");
        refresh.setOnClickListener(v -> refreshDriverStatus());
        root.addView(refresh);

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

        root.addView(text(
            "Stage 1 only tests the FEITIAN POS Server, device information, buzzer and printer. " +
            "EMV, NFC, chip, magstripe and PIN operations remain disabled.",
            12,
            Color.DKGRAY
        ));

        heading(root, "3. myPOS payment package");
        packageStatus = text("Checking…", 16, Color.DKGRAY);
        packageStatus.setPadding(dp(8), dp(10), dp(8), dp(12));
        root.addView(packageStatus);

        heading(root, "4. myPOS Smart SDK POS information");
        sdkStatus = text("Not tested yet.", 15, Color.DKGRAY);
        sdkStatus.setPadding(dp(8), dp(10), dp(8), dp(12));
        root.addView(sdkStatus);

        readPosInfo = button("READ POS INFO THROUGH myPOS DRIVER");
        readPosInfo.setOnClickListener(v -> requestPosInfo());
        root.addView(readPosInfo);

        heading(root, "5. Existing Retaillink sandbox");
        Button sandbox = button("OPEN RETAILLINK SANDBOX TERMINAL");
        sandbox.setOnClickListener(v -> startActivity(new Intent(this, MainActivity.class)));
        root.addView(sandbox);

        TextView boundary = text(
            "SECURITY BOUNDARY\nStage 1 does not request card numbers, PINs or EMV/NFC transaction data. " +
            "Payment methods stay disabled until the vendor service path is verified on supported hardware.",
            12,
            Color.rgb(150, 45, 45)
        );
        boundary.setTypeface(null, 1);
        boundary.setPadding(0, dp(18), 0, 0);
        root.addView(boundary);

        return scroll;
    }

    private void refreshDriverStatus() {
        boolean myPos = myPosDriver.isAvailable(this);
        boolean feitianHardware = feitianDriver.looksLikeFeitianF20();
        boolean feitianServer = feitianDriver.hasPosServerPackage(this);
        TerminalDriver preferredDriver = TerminalDriverRegistry.preferredRealDriver(this);
        String preferred = preferredDriver == null ? "none" : preferredDriver.displayName();

        driverStatus.setText(
            "Sandbox: available\n" +
            "myPOS: " + (myPos ? "available" : "unavailable") + "\n" +
            "FEITIAN F20-class hardware: " + (feitianHardware ? "detected" : "not detected") + "\n" +
            "FEITIAN FTSDK: bundled (" + FeitianDriver.SDK_VERSION + ")\n" +
            "FEITIAN POS Server: " + (feitianServer ? "package visible" : "com.ftpos.apiservice not found") + "\n" +
            "Preferred real driver: " + preferred
        );
        driverStatus.setTextColor(Color.rgb(40, 70, 110));

        if (!feitianHardware) {
            setFeitianStatus("FTSDK is bundled, but this device does not identify as an F20.", Color.rgb(170, 100, 20));
        } else if (!feitianServer) {
            setFeitianStatus(
                "F20 hardware detected. FTSDK is bundled, but com.ftpos.apiservice is not installed/visible.",
                Color.rgb(170, 100, 20)
            );
        } else {
            setFeitianStatus("F20 hardware and FEITIAN POS Server package detected. Ready to bind.", Color.rgb(25, 120, 75));
        }

        if (!myPos) {
            packageStatus.setText("NOT FOUND — package com.mypos is not installed/visible.");
            packageStatus.setTextColor(Color.rgb(170, 40, 40));
            readPosInfo.setEnabled(false);
            setSdkStatus(
                "The myPOS driver is present, but it requires the myPOS payment application/service on the terminal.",
                Color.rgb(170, 100, 20)
            );
        } else {
            packageStatus.setText("FOUND — myPOS driver can see package com.mypos.");
            packageStatus.setTextColor(Color.rgb(25, 120, 75));
            readPosInfo.setEnabled(true);
        }
    }

    private void connectFeitian() {
        setFeitianStatus("Binding to com.ftpos.apiservice…", Color.rgb(40, 70, 110));
        feitianDriver.connect(this, result -> main.post(() ->
            setFeitianStatus(result.message, result.success ? Color.rgb(25, 120, 75) : Color.rgb(170, 40, 40))
        ));
    }

    private void readFeitianInfo() {
        setFeitianStatus("Connecting and reading FEITIAN device information…", Color.rgb(40, 70, 110));
        feitianDriver.getTerminalInfo(this, info -> main.post(() -> {
            if (info == null || !info.success) {
                String details = info == null ? "FEITIAN driver returned no information." : safe(info.details);
                setFeitianStatus(details, Color.rgb(170, 40, 40));
                return;
            }
            setFeitianStatus(
                "FEITIAN DRIVER CONNECTED\n" +
                "Serial: " + printable(info.terminalId) + "\n" +
                info.details,
                Color.rgb(25, 120, 75)
            );
        }));
    }

    private void testFeitianBuzzer() {
        setFeitianStatus("Running FEITIAN buzzer test…", Color.rgb(40, 70, 110));
        feitianDriver.beep(this, result -> main.post(() ->
            setFeitianStatus(result.message, result.success ? Color.rgb(25, 120, 75) : Color.rgb(170, 40, 40))
        ));
    }

    private void testFeitianPrinter() {
        String receipt =
            "RETAILLINK\n" +
            "FEITIAN FTSDK TEST\n" +
            "SDK: " + FeitianDriver.SDK_VERSION + "\n" +
            "Model: " + Build.MODEL + "\n" +
            "Android: " + Build.VERSION.RELEASE + "\n" +
            "No payment processed.";

        setFeitianStatus("Sending diagnostic receipt to FEITIAN printer…", Color.rgb(40, 70, 110));
        feitianDriver.printReceipt(this, receipt, result -> main.post(() ->
            setFeitianStatus(result.message, result.success ? Color.rgb(25, 120, 75) : Color.rgb(170, 40, 40))
        ));
    }

    private void requestPosInfo() {
        if (!myPosDriver.isAvailable(this)) {
            refreshDriverStatus();
            return;
        }

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
            String details = info == null ? "Driver returned no terminal information." : safe(info.details);
            setSdkStatus(details, Color.rgb(170, 100, 20));
            return;
        }

        setSdkStatus(
            "myPOS DRIVER CONNECTED\n" +
            "TID: " + printable(info.terminalId) + "\n" +
            "Currency: " + printable(info.currencyName) + "\n" +
            "Currency code: " + printable(info.currencyCode),
            Color.rgb(25, 120, 75)
        );
    }

    private String safe(String value) {
        return value == null ? "" : value.trim();
    }

    private String printable(String value) {
        String clean = safe(value);
        return clean.isEmpty() ? "(not supplied)" : clean;
    }

    private void setSdkStatus(String value, int color) {
        sdkStatus.setText(value);
        sdkStatus.setTextColor(color);
    }

    private void setFeitianStatus(String value, int color) {
        feitianStatus.setText(value);
        feitianStatus.setTextColor(color);
    }

    private void heading(LinearLayout root, String value) {
        TextView heading = text(value, 18, Color.rgb(20, 24, 30));
        heading.setTypeface(null, 1);
        heading.setPadding(0, dp(18), 0, dp(4));
        root.addView(heading);
    }

    private TextView text(String value, float size, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        return view;
    }

    private Button button(String value) {
        Button button = new Button(this);
        button.setText(value);
        button.setTextSize(14);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, dp(54));
        params.setMargins(0, dp(5), 0, dp(5));
        button.setLayoutParams(params);
        return button;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
