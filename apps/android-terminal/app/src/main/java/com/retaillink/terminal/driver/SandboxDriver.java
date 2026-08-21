package com.retaillink.terminal.driver;

import android.app.Activity;
import android.content.Context;
import android.os.Build;

import java.util.UUID;

public final class SandboxDriver implements TerminalDriver {
    @Override
    public String id() {
        return "sandbox";
    }

    @Override
    public String displayName() {
        return "Retaillink Sandbox";
    }

    @Override
    public boolean isAvailable(Context context) {
        return true;
    }

    @Override
    public void getTerminalInfo(Context context, Callback<TerminalInfo> callback) {
        callback.onResult(new TerminalInfo(
            true,
            id(),
            Build.SERIAL == null ? "sandbox" : Build.SERIAL,
            "Sandbox",
            "LKR",
            "Synthetic terminal driver. No card, NFC, EMV or PIN hardware is accessed."
        ));
    }

    @Override
    public void payment(Activity activity, PaymentRequest request, Callback<TransactionResult> callback) {
        callback.onResult(simulatePayment("approve", request));
    }

    public TransactionResult simulatePayment(String scenario, PaymentRequest request) {
        if ("decline".equals(scenario)) {
            return new TransactionResult(
                false,
                "declined",
                "",
                "Synthetic sandbox decline only. No real payment was attempted."
            );
        }

        if ("3ds".equals(scenario)) {
            return new TransactionResult(
                false,
                "requires_action",
                "sandbox_3ds_" + UUID.randomUUID(),
                "Synthetic 3DS challenge only. No real authentication is performed."
            );
        }

        return new TransactionResult(
            true,
            "approved",
            "sandbox_" + UUID.randomUUID(),
            "Synthetic sandbox approval only. No real payment was processed."
        );
    }

    @Override
    public void refund(Activity activity, PaymentRequest request, Callback<TransactionResult> callback) {
        callback.onResult(new TransactionResult(
            true,
            "refunded",
            "sandbox_refund_" + UUID.randomUUID(),
            "Synthetic sandbox refund only. No real funds were moved."
        ));
    }

    @Override
    public void printReceipt(Activity activity, String receiptText, Callback<OperationResult> callback) {
        callback.onResult(new OperationResult(false, "Sandbox driver has no physical printer."));
    }
}
