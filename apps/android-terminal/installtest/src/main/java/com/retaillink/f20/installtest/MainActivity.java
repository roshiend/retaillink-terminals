package com.retaillink.f20.installtest;

import android.app.Activity;
import android.os.Bundle;
import android.view.Gravity;
import android.widget.TextView;

public class MainActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        TextView message = new TextView(this);
        message.setGravity(Gravity.CENTER);
        message.setTextSize(24f);
        message.setPadding(32, 32, 32, 32);
        message.setText("F20 TEST INSTALLED\n\nNo payment, network, Bluetooth or hardware permissions are used.");
        setContentView(message);
    }
}
