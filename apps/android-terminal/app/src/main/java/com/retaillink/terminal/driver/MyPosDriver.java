package com.retaillink.terminal.driver;

import android.app.Activity;
import android.content.Context;
import android.content.pm.PackageManager;

import com.mypos.smartsdk.MyPOSAPI;
import com.mypos.smartsdk.OnPOSInfoListener;
import com.mypos.smartsdk.data.POSInfo;

public final class MyPosDriver implements TerminalDriver {
    public static final String MYPOS_PACKAGE = "com.mypos";

    @Override
    public String id() {
        return "mypos";
    }

    @Override
    public String displayName() {
        return "myPOS Smart SDK";
    }

    @Override
    public boolean isAvailable(Context context) {
        try {
            context.getPackageManager().getPackageInfo(MYPOS_PACKAGE, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    @Override
    public void getTerminalInfo(Context context, Callback<TerminalInfo> callback) {
        if (!isAvailable(context)) {
            callback.onResult(new TerminalInfo(
                false,
                id(),
                "",
                "",
                "",
                "Package com.mypos is not installed or visible."
            ));
            return;
        }

        try {
            MyPOSAPI.registerPOSInfo(context, new OnPOSInfoListener() {
                @Override
                public void onReceive(POSInfo info) {
                    if (info == null) {
                        callback.onResult(new TerminalInfo(false, id(), "", "", "", "myPOS returned no POS information."));
                        return;
                    }
                    callback.onResult(new TerminalInfo(
                        true,
                        id(),
                        safe(info.getTID()),
                        safe(info.getCurrencyName()),
                        safe(info.getCurrencyCode()),
                        "POS information received through the official myPOS Smart SDK."
                    ));
                }
            });
        } catch (Throwable t) {
            callback.onResult(new TerminalInfo(false, id(), "", "", "", "Smart SDK call failed: " + message(t)));
        }
    }

    @Override
    public void payment(Activity activity, PaymentRequest request, Callback<TransactionResult> callback) {
        callback.onResult(new TransactionResult(
            false,
            "not_enabled",
            "",
            "myPOS payment calls are intentionally disabled until POS-info connectivity is verified on supported hardware."
        ));
    }

    @Override
    public void refund(Activity activity, PaymentRequest request, Callback<TransactionResult> callback) {
        callback.onResult(new TransactionResult(
            false,
            "not_enabled",
            "",
            "myPOS refund calls are intentionally disabled until the payment path is verified."
        ));
    }

    @Override
    public void printReceipt(Activity activity, String receiptText, Callback<OperationResult> callback) {
        callback.onResult(new OperationResult(false, "myPOS printer integration is not enabled in this stage."));
    }

    private static String safe(String value) {
        return value == null ? "" : value.trim();
    }

    private static String message(Throwable t) {
        String value = t.getMessage();
        return value == null || value.trim().isEmpty() ? t.getClass().getSimpleName() : value.trim();
    }
}
