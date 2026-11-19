package com.juicysukun.admin;

import android.os.Build;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins must be registered before super.onCreate().
        registerPlugin(OrderAlarmPlugin.class);
        registerPlugin(BtPrinterPlugin.class);
        registerPlugin(ShareFilePlugin.class);
        registerPlugin(AlarmVoicePlugin.class);
        registerPlugin(PaySmsPlugin.class);
        super.onCreate(savedInstanceState);
        showOverLockScreen();
    }

    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        showOverLockScreen();
        if (getBridge() != null) getBridge().triggerWindowJSEvent("alarmOpened");
    }

    /** When the alarm's full-screen notification opens the app, show it over the lock screen and wake the display. */
    private void showOverLockScreen() {
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        }
    }
}
