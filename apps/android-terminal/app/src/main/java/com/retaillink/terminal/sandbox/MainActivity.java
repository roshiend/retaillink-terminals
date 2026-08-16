package com.retaillink.terminal.sandbox;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final String APPROVE_CARD = "4242424242424242";
    private static final String DECLINE_CARD = "4000000000000002";
    private static final String THREE_DS_CARD = "4000002500003155";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());

    private SharedPreferences prefs;
    private Switch connected;
    private LinearLayout connectionPanel;
    private EditText apiUrl;
    private EditText apiKey;
    private EditText amount;
    private EditText reference;
    private TextView status;
    private Button complete3ds;
    private String pendingCheckoutToken;
    private String pendingActionToken;
    private boolean busy;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("terminal", MODE_PRIVATE);
        setContentView(buildUi());
    }

    @Override
    protected void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
    }

    private View buildUi() {
        ScrollView scroll = new ScrollView(this);
        LinearLayout root = column();
        root.setPadding(dp(18), dp(18), dp(18), dp(30));
        root.setBackgroundColor(Color.rgb(246, 247, 249));
        scroll.addView(root);

        TextView logo = label("RETAILLINK", 14, Color.rgb(230, 105, 30));
        logo.setTypeface(null, 1);
        root.addView(logo);
        TextView title = label("Sandbox Terminal", 28, Color.rgb(20, 24, 30));
        title.setTypeface(null, 1);
        root.addView(title);
        TextView warning = label("SANDBOX ONLY — NO REAL MONEY\nDO NOT ENTER REAL CARD OR PIN DATA", 13, Color.rgb(170, 40, 40));
        warning.setTypeface(null, 1);
        warning.setPadding(0, dp(5), 0, dp(14));
        root.addView(warning);

        connected = new Switch(this);
        connected.setText("Connected sandbox API mode");
        connected.setTextSize(16);
        connected.setChecked(prefs.getBoolean("connected", false));
        root.addView(connected);

        connectionPanel = column();
        connectionPanel.setPadding(0, dp(8), 0, dp(8));
        apiUrl = input("Sandbox API URL", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        apiUrl.setText(prefs.getString("url", ""));
        apiKey = input("Restricted sk_test_... API key", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        apiKey.setText(prefs.getString("key", ""));
        connectionPanel.addView(apiUrl);
        connectionPanel.addView(apiKey);
        Button save = button("Save sandbox connection");
        save.setOnClickListener(v -> saveSettings());
        connectionPanel.addView(save);
        connectionPanel.addView(label("LAN testing may use http://<PC-IP>:3001. Production must use HTTPS.", 12, Color.DKGRAY));
        root.addView(connectionPanel);
        connected.setOnCheckedChangeListener((v, checked) -> {
            prefs.edit().putBoolean("connected", checked).apply();
            updateConnectionPanel();
            setStatus(checked ? "Connected mode selected." : "Offline demo mode — ready.", Color.rgb(40, 70, 110));
        });
        updateConnectionPanel();

        heading(root, "Transaction");
        amount = input("Amount LKR (example 100.00)", InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        amount.setText("100.00");
        reference = input("Reference (optional)", InputType.TYPE_CLASS_TEXT);
        root.addView(amount);
        root.addView(reference);

        Button approve = button("✓ APPROVE TEST PAYMENT");
        approve.setOnClickListener(v -> startPayment("approve"));
        root.addView(approve);
        Button decline = button("✕ DECLINE TEST PAYMENT");
        decline.setOnClickListener(v -> startPayment("decline"));
        root.addView(decline);
        Button threeDs = button("3DS TEST CHALLENGE");
        threeDs.setOnClickListener(v -> startPayment("3ds"));
        root.addView(threeDs);

        complete3ds = button("APPROVE SIMULATED 3DS");
        complete3ds.setVisibility(View.GONE);
        complete3ds.setOnClickListener(v -> finish3ds());
        root.addView(complete3ds);

        status = label("Offline demo mode — ready.", 17, Color.rgb(40, 70, 110));
        status.setPadding(dp(10), dp(14), dp(10), dp(14));
        root.addView(status);

        heading(root, "Device information");
        final String info = deviceInfo();
        root.addView(label(info, 13, Color.DKGRAY));
        Button copy = button("Copy device information");
        copy.setOnClickListener(v -> {
            ClipboardManager cb = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            cb.setPrimaryClip(ClipData.newPlainText("terminal-device-info", info));
            setStatus("Device information copied.", Color.rgb(25, 120, 75));
        });
        root.addView(copy);
        root.addView(label("Built-in chip/NFC/PIN hardware is intentionally NOT accessed in v0.1. We will only enable it through the FEITIAN payment SDK.", 12, Color.rgb(120, 70, 20)));

        return scroll;
    }

    private void startPayment(String scenario) {
        if (busy) return;
        long minor;
        try {
            BigDecimal value = new BigDecimal(amount.getText().toString().trim());
            minor = value.movePointRight(2).setScale(0, RoundingMode.UNNECESSARY).longValueExact();
            if (minor <= 0) throw new IllegalArgumentException();
        } catch (Exception e) {
            setStatus("Enter a valid positive amount such as 100.00", Color.rgb(170, 40, 40));
            return;
        }

        pendingCheckoutToken = null;
        pendingActionToken = null;
        complete3ds.setVisibility(View.GONE);

        if (!connected.isChecked()) {
            offlineScenario(scenario, minor);
            return;
        }

        String base = normalize(apiUrl.getText().toString());
        String key = apiKey.getText().toString().trim();
        if (base.isEmpty() || !key.startsWith("sk_test_")) {
            setStatus("Connected mode requires an API URL and sk_test_ key.", Color.rgb(170, 40, 40));
            return;
        }
        saveSettings();
        setBusy(true);
        setStatus("Creating sandbox Payment Intent…", Color.rgb(40, 70, 110));
        final long amountMinor = minor;
        executor.execute(() -> connectedScenario(base, key, scenario, amountMinor));
    }

    private void offlineScenario(String scenario, long minor) {
        String money = new BigDecimal(minor).movePointLeft(2).toPlainString() + " LKR";
        if ("approve".equals(scenario)) {
            setStatus("APPROVED • " + money + "\nOffline simulator only.", Color.rgb(25, 120, 75));
        } else if ("decline".equals(scenario)) {
            setStatus("DECLINED • " + money + "\nOffline simulator only.", Color.rgb(170, 40, 40));
        } else {
            pendingCheckoutToken = "offline";
            pendingActionToken = "offline";
            complete3ds.setVisibility(View.VISIBLE);
            setStatus("3DS REQUIRED • " + money + "\nPress APPROVE SIMULATED 3DS.", Color.rgb(170, 100, 20));
        }
    }

    private void connectedScenario(String base, String key, String scenario, long minor) {
        try {
            JSONObject create = new JSONObject();
            create.put("amount", minor);
            create.put("currency", "LKR");
            String ref = reference.getText().toString().trim();
            if (!ref.isEmpty()) create.put("merchant_reference", ref);
            create.put("description", "F20 Android terminal sandbox test");

            HttpResult created = call("POST", base + "/v1/payment_intents", key, "terminal_" + UUID.randomUUID(), create);
            if (created.code < 200 || created.code >= 300) throw new Exception(errorText(created));
            JSONObject intent = new JSONObject(created.body);
            String checkoutUrl = intent.getString("checkout_url");
            String token = checkoutUrl.substring(checkoutUrl.lastIndexOf('/') + 1);
            String card = "approve".equals(scenario) ? APPROVE_CARD : ("decline".equals(scenario) ? DECLINE_CARD : THREE_DS_CARD);

            JSONObject confirm = new JSONObject();
            confirm.put("card_number", card);
            confirm.put("expiry", "12/35");
            confirm.put("cvc", "123");
            HttpResult result = call("POST", base + "/checkout/" + token + "/confirm", null, null, confirm);

            if ("decline".equals(scenario)) {
                postStatus("DECLINED as expected • HTTP " + result.code, Color.rgb(170, 40, 40));
                return;
            }
            if (result.code < 200 || result.code >= 300) throw new Exception(errorText(result));
            JSONObject body = new JSONObject(result.body);
            if ("requires_action".equals(body.optString("status"))) {
                pendingCheckoutToken = token;
                pendingActionToken = body.getString("action_token");
                main.post(() -> {
                    complete3ds.setVisibility(View.VISIBLE);
                    setStatus("3DS REQUIRED — press APPROVE SIMULATED 3DS.", Color.rgb(170, 100, 20));
                    setBusy(false);
                });
                return;
            }
            postStatus("APPROVED — sandbox Payment recorded in Retaillink.", Color.rgb(25, 120, 75));
        } catch (Exception e) {
            postStatus("ERROR — " + e.getMessage(), Color.rgb(170, 40, 40));
        } finally {
            main.post(() -> { if (pendingActionToken == null) setBusy(false); });
        }
    }

    private void finish3ds() {
        if ("offline".equals(pendingCheckoutToken)) {
            pendingCheckoutToken = null;
            pendingActionToken = null;
            complete3ds.setVisibility(View.GONE);
            setStatus("3DS APPROVED • Offline simulator only.", Color.rgb(25, 120, 75));
            return;
        }
        if (pendingCheckoutToken == null || pendingActionToken == null || busy) return;
        String base = normalize(apiUrl.getText().toString());
        setBusy(true);
        setStatus("Completing simulated 3DS…", Color.rgb(40, 70, 110));
        executor.execute(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("action_token", pendingActionToken);
                HttpResult result = call("POST", base + "/checkout/" + pendingCheckoutToken + "/3ds/complete", null, null, body);
                if (result.code < 200 || result.code >= 300) throw new Exception(errorText(result));
                pendingCheckoutToken = null;
                pendingActionToken = null;
                main.post(() -> complete3ds.setVisibility(View.GONE));
                postStatus("3DS APPROVED — sandbox Payment recorded.", Color.rgb(25, 120, 75));
            } catch (Exception e) {
                postStatus("3DS ERROR — " + e.getMessage(), Color.rgb(170, 40, 40));
            } finally {
                main.post(() -> setBusy(false));
            }
        });
    }

    private HttpResult call(String method, String url, String bearer, String idempotency, JSONObject body) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(8000);
        connection.setReadTimeout(10000);
        connection.setRequestProperty("Accept", "application/json");
        if (bearer != null) connection.setRequestProperty("Authorization", "Bearer " + bearer);
        if (idempotency != null) connection.setRequestProperty("Idempotency-Key", idempotency);
        if (body != null) {
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream out = connection.getOutputStream()) { out.write(bytes); }
        }
        int code = connection.getResponseCode();
        InputStream stream = code >= 400 ? connection.getErrorStream() : connection.getInputStream();
        StringBuilder value = new StringBuilder();
        if (stream != null) {
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) value.append(line);
            }
        }
        connection.disconnect();
        return new HttpResult(code, value.toString());
    }

    private String errorText(HttpResult result) {
        try {
            JSONObject json = new JSONObject(result.body);
            JSONObject error = json.optJSONObject("error");
            if (error != null) return error.optString("message", "HTTP " + result.code);
        } catch (Exception ignored) { }
        return "HTTP " + result.code;
    }

    private void saveSettings() {
        String url = normalize(apiUrl.getText().toString());
        String key = apiKey.getText().toString().trim();
        prefs.edit().putString("url", url).putString("key", key).apply();
        apiUrl.setText(url);
    }

    private String normalize(String value) {
        String out = value == null ? "" : value.trim();
        while (out.endsWith("/")) out = out.substring(0, out.length() - 1);
        return out;
    }

    private String deviceInfo() {
        return "Manufacturer: " + Build.MANUFACTURER +
            "\nBrand: " + Build.BRAND +
            "\nModel: " + Build.MODEL +
            "\nDevice: " + Build.DEVICE +
            "\nProduct: " + Build.PRODUCT +
            "\nAndroid: " + Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ")" +
            "\nBuild: " + Build.DISPLAY;
    }

    private void setBusy(boolean value) { busy = value; }
    private void postStatus(String value, int color) { main.post(() -> { setStatus(value, color); setBusy(false); }); }
    private void setStatus(String value, int color) { if (status != null) { status.setText(value); status.setTextColor(color); } }
    private void updateConnectionPanel() { if (connectionPanel != null) connectionPanel.setVisibility(connected.isChecked() ? View.VISIBLE : View.GONE); }

    private LinearLayout column() { LinearLayout l = new LinearLayout(this); l.setOrientation(LinearLayout.VERTICAL); return l; }
    private TextView label(String value, float size, int color) { TextView v = new TextView(this); v.setText(value); v.setTextSize(size); v.setTextColor(color); return v; }
    private EditText input(String hint, int type) { EditText v = new EditText(this); v.setHint(hint); v.setInputType(type); v.setTextSize(16); v.setPadding(dp(10), dp(10), dp(10), dp(10)); return v; }
    private Button button(String value) { Button b = new Button(this); b.setText(value); b.setTextSize(15); LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, dp(54)); p.setMargins(0, dp(5), 0, dp(5)); b.setLayoutParams(p); return b; }
    private void heading(LinearLayout root, String value) { TextView v = label(value, 18, Color.rgb(20,24,30)); v.setTypeface(null,1); v.setPadding(0,dp(16),0,dp(7)); root.addView(v); }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private static final class HttpResult {
        final int code;
        final String body;
        HttpResult(int code, String body) { this.code = code; this.body = body; }
    }
}
