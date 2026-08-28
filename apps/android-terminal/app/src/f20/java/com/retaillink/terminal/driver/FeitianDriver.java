package com.retaillink.terminal.driver;

import android.app.Activity;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import com.ftpos.library.smartpos.buzzer.Buzzer;
import com.ftpos.library.smartpos.buzzer.BuzzerMode;
import com.ftpos.library.smartpos.device.Device;
import com.ftpos.library.smartpos.errcode.ErrCode;
import com.ftpos.library.smartpos.printer.AlignStyle;
import com.ftpos.library.smartpos.printer.OnPrinterCallback;
import com.ftpos.library.smartpos.printer.PrintStatus;
import com.ftpos.library.smartpos.printer.Printer;
import com.ftpos.library.smartpos.servicemanager.OnServiceConnectCallback;
import com.ftpos.library.smartpos.servicemanager.ServiceManager;

import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

public final class FeitianDriver implements TerminalDriver {
    public static final String POS_SERVER_PACKAGE = "com.ftpos.apiservice";
    public static final String SDK_VERSION = "FTSDK_api_V1.0.0.71";
    private static final long CONNECT_TIMEOUT_MS = 5000L;

    private final Handler main = new Handler(Looper.getMainLooper());
    private volatile boolean connected;

    @Override public String id() { return "feitian"; }
    @Override public String displayName() { return "FEITIAN FTSDK"; }
    @Override public boolean isAvailable(Context context) { return looksLikeFeitianF20() && hasPosServerPackage(context); }
    public boolean isSdkBundled() { return true; }

    public boolean hasPosServerPackage(Context context) {
        try {
            context.getPackageManager().getPackageInfo(POS_SERVER_PACKAGE, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    public boolean looksLikeFeitianF20() {
        String model = Build.MODEL == null ? "" : Build.MODEL;
        String product = Build.PRODUCT == null ? "" : Build.PRODUCT;
        String device = Build.DEVICE == null ? "" : Build.DEVICE;
        return containsF20(model) || containsF20(product) || containsF20(device);
    }

    public void connect(Context context, Callback<OperationResult> callback) {
        Context appContext = context.getApplicationContext();
        if (!looksLikeFeitianF20()) {
            callback.onResult(new OperationResult(false, "This device does not identify as FEITIAN F20-class hardware."));
            return;
        }
        if (!hasPosServerPackage(appContext)) {
            connected = false;
            callback.onResult(new OperationResult(false, "FTSDK is bundled, but FEITIAN POS Server package com.ftpos.apiservice is not installed/visible."));
            return;
        }
        if (connected) {
            try {
                if (ServiceManager.checkServiceManager(appContext)) {
                    callback.onResult(new OperationResult(true, "FEITIAN POS Server already connected."));
                    return;
                }
                connected = false;
            } catch (Throwable ignored) { connected = false; }
        }

        AtomicBoolean delivered = new AtomicBoolean(false);
        Runnable timeout = () -> {
            if (delivered.compareAndSet(false, true)) {
                connected = false;
                callback.onResult(new OperationResult(false, "Timed out while binding to FEITIAN POS Server."));
            }
        };
        main.postDelayed(timeout, CONNECT_TIMEOUT_MS);
        try {
            ServiceManager.bindPosServer(appContext, new OnServiceConnectCallback() {
                @Override public void onSuccess() {
                    if (!delivered.compareAndSet(false, true)) return;
                    main.removeCallbacks(timeout);
                    connected = true;
                    callback.onResult(new OperationResult(true, "Connected to FEITIAN POS Server."));
                }
                @Override public void onFail(int code) {
                    if (!delivered.compareAndSet(false, true)) return;
                    main.removeCallbacks(timeout);
                    connected = false;
                    callback.onResult(new OperationResult(false, "FEITIAN POS Server bind failed: " + errorText(code)));
                }
            });
        } catch (Throwable t) {
            if (delivered.compareAndSet(false, true)) {
                main.removeCallbacks(timeout);
                connected = false;
                callback.onResult(new OperationResult(false, "FEITIAN POS Server bind threw: " + message(t)));
            }
        }
    }

    @Override
    public void getTerminalInfo(Context context, Callback<TerminalInfo> callback) {
        Context appContext = context.getApplicationContext();
        connect(appContext, connection -> {
            if (!connection.success) {
                callback.onResult(new TerminalInfo(false, id(), "", "", "", connection.message));
                return;
            }
            try {
                Device device = Device.getInstance(appContext);
                if (device == null) {
                    callback.onResult(new TerminalInfo(false, id(), "", "", "", "FTSDK connected but Device service is unavailable."));
                    return;
                }
                String serial = safe(device.getSerialNumber());
                String productModel = safe(device.getProductModel());
                String hardwareVersion = safe(device.getHardwareVersion());
                String posServerVersion = safe(device.getPosServerVersion());
                String secureFirmwareVersion = safe(device.getSecureFirmwareVersion());
                String sdkVersion = safe(device.getSDKVersionName());
                Map modules = device.getSystemModulesVersion();
                String details = "Product model: " + printable(productModel) + "\n" +
                    "Hardware: " + printable(hardwareVersion) + "\n" +
                    "POS Server: " + printable(posServerVersion) + "\n" +
                    "Secure firmware: " + printable(secureFirmwareVersion) + "\n" +
                    "FTSDK: " + printable(sdkVersion) + "\n" +
                    "FTSDK device mode: " + ServiceManager.getDeviceModel() +
                    (modules == null ? "" : "\nSystem modules: " + modules.toString());
                callback.onResult(new TerminalInfo(true, id(), serial, "", "", details));
            } catch (Throwable t) {
                callback.onResult(new TerminalInfo(false, id(), "", "", "", "FTSDK device-info call failed: " + message(t)));
            }
        });
    }

    @Override public void payment(Activity activity, PaymentRequest request, Callback<TransactionResult> callback) {
        callback.onResult(new TransactionResult(false, "not_enabled", "", "FEITIAN EMV/card payment integration is intentionally disabled in FTSDK Stage 1."));
    }
    @Override public void refund(Activity activity, PaymentRequest request, Callback<TransactionResult> callback) {
        callback.onResult(new TransactionResult(false, "not_enabled", "", "FEITIAN refund/payment integration is intentionally disabled in FTSDK Stage 1."));
    }

    @Override
    public void printReceipt(Activity activity, String receiptText, Callback<OperationResult> callback) {
        if (receiptText == null || receiptText.trim().isEmpty()) {
            callback.onResult(new OperationResult(false, "Receipt text is empty."));
            return;
        }
        connect(activity, connection -> {
            if (!connection.success) { callback.onResult(connection); return; }
            Printer printer = null;
            try {
                printer = Printer.getInstance(activity);
                if (printer == null) { callback.onResult(new OperationResult(false, "FTSDK connected but printer service is unavailable.")); return; }
                int ret = printer.open();
                if (ret != ErrCode.ERR_SUCCESS) { callback.onResult(new OperationResult(false, "Printer open failed: " + errorText(ret))); return; }
                ret = printer.startCaching();
                if (ret != ErrCode.ERR_SUCCESS) { safeClose(printer); callback.onResult(new OperationResult(false, "Printer cache start failed: " + errorText(ret))); return; }
                PrintStatus printStatus = new PrintStatus();
                ret = printer.getStatus(printStatus);
                if (ret != ErrCode.ERR_SUCCESS) { safeClose(printer); callback.onResult(new OperationResult(false, "Printer status failed: " + errorText(ret))); return; }
                if (Boolean.FALSE.equals(printStatus.getmIsHavePaper())) { safeClose(printer); callback.onResult(new OperationResult(false, "Printer reports no paper.")); return; }
                ret = printer.setGray(3);
                if (ret != ErrCode.ERR_SUCCESS) { safeClose(printer); callback.onResult(new OperationResult(false, "Printer gray-level setup failed: " + errorText(ret))); return; }
                ret = printer.setAlignStyle(AlignStyle.PRINT_STYLE_LEFT);
                if (ret != ErrCode.ERR_SUCCESS) { safeClose(printer); callback.onResult(new OperationResult(false, "Printer alignment failed: " + errorText(ret))); return; }
                ret = printer.printStr(receiptText.trim() + "\n\n");
                if (ret != ErrCode.ERR_SUCCESS) { safeClose(printer); callback.onResult(new OperationResult(false, "Printer text buffering failed: " + errorText(ret))); return; }
                Printer finalPrinter = printer;
                printer.print(new OnPrinterCallback() {
                    @Override public void onSuccess() {
                        try { finalPrinter.feed(32); } catch (Throwable ignored) { }
                        safeClose(finalPrinter);
                        callback.onResult(new OperationResult(true, "FEITIAN printer test completed successfully."));
                    }
                    @Override public void onError(int code) {
                        safeClose(finalPrinter);
                        callback.onResult(new OperationResult(false, "FEITIAN printer test failed: " + errorText(code)));
                    }
                });
            } catch (Throwable t) {
                safeClose(printer);
                callback.onResult(new OperationResult(false, "FEITIAN printer call threw: " + message(t)));
            }
        });
    }

    public void beep(Activity activity, Callback<OperationResult> callback) {
        connect(activity, connection -> {
            if (!connection.success) { callback.onResult(connection); return; }
            try {
                Buzzer buzzer = Buzzer.getInstance(activity);
                if (buzzer == null) { callback.onResult(new OperationResult(false, "FTSDK connected but buzzer service is unavailable.")); return; }
                int ret = buzzer.setBuzzerFrequency(2000);
                if (ret != ErrCode.ERR_SUCCESS) { callback.onResult(new OperationResult(false, "Buzzer frequency setup failed: " + errorText(ret))); return; }
                ret = buzzer.beep(1, 120, 80, BuzzerMode.BUZZER_MODE_ASYNC);
                callback.onResult(new OperationResult(ret == ErrCode.ERR_SUCCESS,
                    ret == ErrCode.ERR_SUCCESS ? "FEITIAN buzzer test completed." : "FEITIAN buzzer test failed: " + errorText(ret)));
            } catch (Throwable t) {
                callback.onResult(new OperationResult(false, "FEITIAN buzzer call threw: " + message(t)));
            }
        });
    }

    private static void safeClose(Printer printer) { if (printer != null) try { printer.close(); } catch (Throwable ignored) { } }
    private static String errorText(int code) {
        String description = "";
        try { description = ErrCode.toString(code); } catch (Throwable ignored) { }
        if (description == null) description = "";
        description = description.trim();
        String hex = String.format("0x%08X", code);
        return description.isEmpty() ? hex : hex + " — " + description;
    }
    private static String safe(String value) { return value == null ? "" : value.trim(); }
    private static String printable(String value) { String clean = safe(value); return clean.isEmpty() ? "(not supplied)" : clean; }
    private static String message(Throwable t) { String value = t.getMessage(); return value == null || value.trim().isEmpty() ? t.getClass().getSimpleName() : value.trim(); }
    private static boolean containsF20(String value) { return value.toUpperCase().contains("F20"); }
}
