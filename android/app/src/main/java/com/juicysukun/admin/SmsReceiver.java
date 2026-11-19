package com.juicysukun.admin;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Tells the app "an SMS just arrived" so it can check for a matching bank credit straight away. */
public class SmsReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        PaySmsPlugin.ping();
    }
}
