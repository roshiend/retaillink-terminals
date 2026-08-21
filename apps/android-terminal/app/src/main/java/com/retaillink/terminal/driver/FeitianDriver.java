package com.retaillink.terminal.driver;

import android.app.Activity;
import android.content.Context;
import android.os.Build;

public final class FeitianDriver implements TerminalDriver {
    @Override
    public String id() {
        return "feitian";
    }

    @Override
    public String displayName() {
        return "FEITIAN FTSDK";
    }

    @Override
    public boolean isAvailable(Context context) {
        // Do not guess an FTSDK class name or bind to undocumented services.
        // Availability remains false until the official F20 SDK dependency is added.
        return false;
    }

    public boolean looksLikeFeitianF20() {
        String model = Build.MODEL == null ? "" : Build.MODEL;
        String product = Build.PRODUCT == null ? "" : Build.PRODUCT;
        String device = Build.DEVICE == null ? "" : Build.DEVICE;
        return containsF20(model) || containsF20(product) || containsF20(device);
    }

    @Override
    public void getTerminalInfo(Context context, Callback<TerminalInfo> callback) {
        String details = looksLikeFeitianF20()
            ? "F20-class hardware detected, but the official FEITIAN FTSDK is not bundled yet."
            : "Official FEITIAN FTSDK is not bundled yet.";
        callback.onResult(new TerminalInfo(false, id(), "", "", "", details));
    }

    @Override
    public void payment(Activity activity, PaymentRequest request, Callback<TransactionResult> callback) {
        callback.onResult(new TransactionResult(false, "sdk_missing", "", "Official FEITIAN FTSDK is required before payment integration can be implemented."));
    }

    @Override
    public void refund(Activity activity, PaymentRequest request, Callback<TransactionResult> callback) {
        callback.onResult(new TransactionResult(false, "sdk_missing", "", "Official FEITIAN FTSDK is required before refund integration can be implemented."));
    }

    @Override
    public void printReceipt(Activity activity, String receiptText, Callback<OperationResult> callback) {
        callback.onResult(new OperationResult(false, "Official FEITIAN FTSDK is required before printer integration can be implemented."));
    }

    private static boolean containsF20(String value) {
        return value.toUpperCase().contains("F20");
    }
}
