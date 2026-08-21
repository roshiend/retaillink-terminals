package com.retaillink.terminal.driver;

import android.app.Activity;
import android.content.Context;

public interface TerminalDriver {
    String id();
    String displayName();
    boolean isAvailable(Context context);

    void getTerminalInfo(Context context, Callback<TerminalInfo> callback);
    void payment(Activity activity, PaymentRequest request, Callback<TransactionResult> callback);
    void refund(Activity activity, PaymentRequest request, Callback<TransactionResult> callback);
    void printReceipt(Activity activity, String receiptText, Callback<OperationResult> callback);

    interface Callback<T> {
        void onResult(T result);
    }

    final class TerminalInfo {
        public final boolean success;
        public final String driverId;
        public final String terminalId;
        public final String currencyName;
        public final String currencyCode;
        public final String details;

        public TerminalInfo(boolean success, String driverId, String terminalId, String currencyName, String currencyCode, String details) {
            this.success = success;
            this.driverId = driverId;
            this.terminalId = terminalId;
            this.currencyName = currencyName;
            this.currencyCode = currencyCode;
            this.details = details;
        }
    }

    final class PaymentRequest {
        public final long amountMinor;
        public final String currencyCode;
        public final String reference;

        public PaymentRequest(long amountMinor, String currencyCode, String reference) {
            this.amountMinor = amountMinor;
            this.currencyCode = currencyCode;
            this.reference = reference;
        }
    }

    final class TransactionResult {
        public final boolean success;
        public final String status;
        public final String transactionId;
        public final String message;

        public TransactionResult(boolean success, String status, String transactionId, String message) {
            this.success = success;
            this.status = status;
            this.transactionId = transactionId;
            this.message = message;
        }
    }

    final class OperationResult {
        public final boolean success;
        public final String message;

        public OperationResult(boolean success, String message) {
            this.success = success;
            this.message = message;
        }
    }
}
