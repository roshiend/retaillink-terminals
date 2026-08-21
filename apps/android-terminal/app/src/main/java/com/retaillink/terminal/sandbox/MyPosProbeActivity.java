package com.retaillink.terminal.sandbox;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
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
            "DRIVER ABSTRACTION — SANDBOX / myPOS / FEITIAN\nNo raw card, NFC, EMV or PIN data is read by Retaillink.",
            13,
            Color.rgb(120, 70, 20)
        );
        stage.setPadding(0, dp(6), 0, dp(16));
        root.addView(stage);

        heading(root, "1. Driver registry");
        driverStatus = text("Checking…", 15, Color.DKGRAY);
        driverStatus.setPadding(dp(8), dp(10), dp(8), dp(12));
        root.addView(driverStatus);

        heading(root, "2. myPOS payment package");
        packageStatus = text("Checking…", 16, Color.DKGRAY);
        packageStatus.setPadding(dp(8), dp(10), dp(8), dp(12));
        root.addView(packageStatus);

        Button refresh = button("REFRESH DRIVER STATUS");
        refresh.setOnClickListener(v -> refreshDriverStatus());
        root.addView(refresh);

        heading(root, "3. myPOS Smart SDK POS information");
        sdkStatus = text("Not tested yet.", 15, Color.DKGRAY);
        sdkStatus.setPadding(dp(8), dp(10), dp(8), dp(12));
        root.addView(sdkStatus);

        readPosInfo = button("READ POS INFO THROUGH myPOS DRIVER");
        readPosInfo.setOnClickListener(v -> requestPosInfo());
        root.addView(readPosInfo);

        root.addView(text(
            "Payment/refund calls stay disabled until this driver can successfully read POS information on supported hardware.",
            12,
            Color.DKGRAY
        ));

        heading(root, "4. Existing Retaillink sandbox");
        Button sandbox = button("OPEN RETAILLINK SANDBOX TERMINAL");
        sandbox.setOnClickListener(v -> startActivity(new Intent(this, MainActivity.class)));
        root.addView(sandbox);

        TextView boundary = text(
            "SECURITY BOUNDARY\nVendor drivers delegate secure payment handling to the vendor-certified payment stack. " +
            "Retaillink does not request or store PAN, CVV or PIN.",
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
        boolean feitianCandidate = feitianDriver.looksLikeFeitianF20();
        boolean feitianSdk = feitianDriver.isAvailable(this);

        String preferred = TerminalDriverRegistry.preferredRealDriver(this) == null
            ? "none"
            : TerminalDriverRegistry.preferredRealDriver(this).displayName();

        driverStatus.setText(
            "Sandbox: available\n" +
            "myPOS: " + (myPos ? "available" : "unavailable") + "\n" +
            "FEITIAN F20-class hardware: " + (feitianCandidate ? "detected" : "not detected") + "\n" +
            "FEITIAN FTSDK: " + (feitianSdk ? "available" : "not bundled") + "\n" +
            "Preferred real driver: " + preferred
        );
        driverStatus.setTextColor(Color.rgb(40, 70, 110));

        if (!myPos) {
            packageStatus.setText("NOT FOUND — package com.mypos is not installed/visible.");
            packageStatus.setTextColor(Color.rgb(170, 40, 40));
            readPosInfo.setEnabled(false);
            setSdkStatus(
                "The myPOS driver is present, but it requires the myPOS payment application/service on the terminal.",
                Color.rgb(170, 100, 20)
            );
            return;
        }

        packageStatus.setText("FOUND — myPOS driver can see package com.mypos.");
        packageStatus.setTextColor(Color.rgb(25, 120, 75));
        readPosInfo.setEnabled(true);
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
