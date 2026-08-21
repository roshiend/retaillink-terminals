package com.retaillink.terminal.driver;

import android.content.Context;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

public final class TerminalDriverRegistry {
    private static final SandboxDriver SANDBOX = new SandboxDriver();
    private static final MyPosDriver MYPOS = new MyPosDriver();
    private static final FeitianDriver FEITIAN = new FeitianDriver();

    private TerminalDriverRegistry() {
    }

    public static List<TerminalDriver> all() {
        return Collections.unmodifiableList(Arrays.asList(SANDBOX, MYPOS, FEITIAN));
    }

    public static SandboxDriver sandbox() {
        return SANDBOX;
    }

    public static MyPosDriver myPos() {
        return MYPOS;
    }

    public static FeitianDriver feitian() {
        return FEITIAN;
    }

    public static TerminalDriver preferredRealDriver(Context context) {
        if (MYPOS.isAvailable(context)) return MYPOS;
        if (FEITIAN.isAvailable(context)) return FEITIAN;
        return null;
    }
}
