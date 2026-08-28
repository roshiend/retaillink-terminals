package com.retaillink.terminal.driver;

import android.app.Activity;
import android.content.Context;

public final class FeitianDriver implements TerminalDriver {
    public static final String POS_SERVER_PACKAGE = "com.ftpos.apiservice";
    public static final String SDK_VERSION = "not bundled in AppMarket build";

    @Override public String id() { return "feitian"; }
    @Override public String displayName() { return "FEITIAN FTSDK"; }
    @Override public boolean isAvailable(Context context) { return false; }

    public boolean isSdkBundled() { return false; }
    public boolean hasPosServerPackage(Context context) { return false; }
    public boolean looksLikeFeitianF20() { return false; }
    public void connect(Context context, Callback<OperationResult> callback) {
        callback.onResult(new OperationResult(false, "FEITIAN FTSDK is intentionally excluded from the myPOS AppMarket build."));
    }
    public void beep(Activity activity, Callback<OperationResult> callback) {
        callback.onResult(new OperationResult(false, "FEITIAN FTSDK is intentionally excluded from the myPOS AppMarket build."));
    }

    @Override public void getTerminalInfo(Context context, Callback<TerminalInfo> callback) {
        callback.onResult(new TerminalInfo(false, id(), "", "", "", "FEITIAN FTSDK is intentionally excluded from the myPOS AppMarket build."));
    }
    @Override public void payment(Activity activity, PaymentRequest request, Callback<TransactionResult> callback) {
        callback.onResult(new TransactionResult(false, "not_available", "", "FEITIAN payment path is not part of the myPOS AppMarket build."));
    }
    @Override public void refund(Activity activity, PaymentRequest request, Callback<TransactionResult> callback) {
        callback.onResult(new TransactionResult(false, "not_available", "", "FEITIAN payment path is not part of the myPOS AppMarket build."));
    }
    @Override public void printReceipt(Activity activity, String receiptText, Callback<OperationResult> callback) {
        callback.onResult(new OperationResult(false, "FEITIAN printer path is not part of the myPOS AppMarket build."));
    }
}
