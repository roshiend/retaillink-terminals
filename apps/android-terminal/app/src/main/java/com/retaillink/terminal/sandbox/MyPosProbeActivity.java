package com.retaillink.terminal.sandbox;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import com.mypos.smartsdk.MyPOSAPI;
import com.mypos.smartsdk.OnPOSInfoListener;
import com.mypos.smartsdk.data.POSInfo;

public class MyPosProbeActivity extends Activity {
    private static final String MYPOS_PACKAGE = "com.mypos";
    private static final long POS_INFO_TIMEOUT_MS = 5000L;

    private final Handler main = new Handler(Looper.getMainLooper());
    private TextView packageStatus;
    private TextView sdkStatus;
    private Button readPosInfo;
    private boolean waitingForPosInfo;

    private final Runnable posInfoTimeout = () -> {
        if (!waitingForPosInfo) return;
        waitingForPosInfo = false;
        readPosInfo.setEnabled(true);
        setSdkStatus(
            "No POS-info response after 5 seconds. The SDK is present in this app, but the " +
            "myPOS payment service/provider is not responding on this firmware.",
            Color.rgb(170, 100, 20)
        );
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(buildUi());
        refreshPackageStatus();
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

        TextView title = text("F20 • myPOS Smart SDK", 25, Color.rgb(20, 24, 30));
        title.setTypeface(null, 1);
        root.addView(title);

        TextView stage = text(
            "STAGE 1 — SDK / PAYMENT-SERVICE DETECTION\nNo card, NFC or PIN data is read by Retaillink.",
            13,
            Color.rgb(120, 70, 20)
        );
        stage.setPadding(0, dp(6), 0, dp(16));
        root.addView(stage);

        heading(root, "1. myPOS payment package");
        packageStatus = text("Checking…", 16, Color.DKGRAY);
        packageStatus.setPadding(dp(8), dp(10), dp(8), dp(12));
        root.addView(packageStatus);

        Button refresh = button("CHECK com.mypos AGAIN");
        refresh.setOnClickListener(v -> refreshPackageStatus());
        root.addView(refresh);

        heading(root, "2. Smart SDK POS information");
        sdkStatus = text("Not tested yet.", 15, Color.DKGRAY);
        sdkStatus.setPadding(dp(8), dp(10), dp(8), dp(12));
        root.addView(sdkStatus);

        readPosInfo = button("READ POS INFO WITH SMART SDK");
        readPosInfo.setOnClickListener(v -> requestPosInfo());
        root.addView(readPosInfo);

        root.addView(text(
            "A successful response proves that this firmware exposes the myPOS Smart SDK " +
            "communication path. We will add payment/refund calls only after this stage works.",
            12,
            Color.DKGRAY
        ));

        heading(root, "3. Existing Retaillink sandbox");
        Button sandbox = button("OPEN RETAILLINK SANDBOX TERMINAL");
        sandbox.setOnClickListener(v -> startActivity(new Intent(this, MainActivity.class)));
        root.addView(sandbox);

        TextView boundary = text(
            "SECURITY BOUNDARY\nThe Smart SDK delegates payment handling to the certified myPOS payment " +
            "application. Retaillink does not request or store PAN, CVV or PIN.",
            12,
            Color.rgb(150, 45, 45)
        );
        boundary.setTypeface(null, 1);
        boundary.setPadding(0, dp(18), 0, 0);
        root.addView(boundary);

        return scroll;
    }

    private void refreshPackageStatus() {
        PackageInfo info = findPackage(MYPOS_PACKAGE);
        if (info == null) {
            packageStatus.setText("NOT FOUND — package com.mypos is not installed/visible.");
            packageStatus.setTextColor(Color.rgb(170, 40, 40));
            readPosInfo.setEnabled(false);
            setSdkStatus(
                "Smart SDK library is compiled into Retaillink, but it needs the myPOS payment " +
                "application/service on the terminal before POS info or payments can work.",
                Color.rgb(170, 100, 20)
            );
            return;
        }

        String version = info.versionName == null ? "unknown" : info.versionName;
        packageStatus.setText("FOUND — com.mypos version " + version);
        packageStatus.setTextColor(Color.rgb(25, 120, 75));
        readPosInfo.setEnabled(true);
    }

    private PackageInfo findPackage(String packageName) {
        try {
            return getPackageManager().getPackageInfo(packageName, 0);
        } catch (PackageManager.NameNotFoundException e) {
            return null;
        }
    }

    private void requestPosInfo() {
        if (findPackage(MYPOS_PACKAGE) == null) {
            refreshPackageStatus();
            return;
        }

        waitingForPosInfo = true;
        readPosInfo.setEnabled(false);
        setSdkStatus("Requesting POS info from com.mypos…", Color.rgb(40, 70, 110));
        main.removeCallbacks(posInfoTimeout);
        main.postDelayed(posInfoTimeout, POS_INFO_TIMEOUT_MS);

        try {
            MyPOSAPI.registerPOSInfo(this, new OnPOSInfoListener() {
                @Override
                public void onReceive(POSInfo info) {
                    main.post(() -> handlePosInfo(info));
                }
            });
        } catch (Throwable t) {
            waitingForPosInfo = false;
            main.removeCallbacks(posInfoTimeout);
            readPosInfo.setEnabled(true);
            String message = t.getMessage();
            if (message == null || message.trim().isEmpty()) {
                message = t.getClass().getSimpleName();
            }
            setSdkStatus("Smart SDK call failed: " + message, Color.rgb(170, 40, 40));
        }
    }

    private void handlePosInfo(POSInfo info) {
        if (!waitingForPosInfo) return;
        waitingForPosInfo = false;
        main.removeCallbacks(posInfoTimeout);
        readPosInfo.setEnabled(true);

        if (info == null) {
            setSdkStatus("Smart SDK returned no POS information.", Color.rgb(170, 100, 20));
            return;
        }

        String tid = safe(info.getTID());
        String currencyName = safe(info.getCurrencyName());
        String currencyCode = safe(info.getCurrencyCode());

        setSdkStatus(
            "SMART SDK CONNECTED\n" +
            "TID: " + tid + "\n" +
            "Currency: " + currencyName + "\n" +
            "Currency code: " + currencyCode,
            Color.rgb(25, 120, 75)
        );
    }

    private String safe(String value) {
        return value == null || value.trim().isEmpty() ? "(not supplied)" : value.trim();
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
