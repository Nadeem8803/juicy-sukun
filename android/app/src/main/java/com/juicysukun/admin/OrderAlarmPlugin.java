package com.juicysukun.admin;

import android.Manifest;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.messaging.FirebaseMessaging;

/** JavaScript bridge: window.Capacitor.Plugins.OrderAlarm (see projects/admin/src/app/core/alarm.ts). */
@CapacitorPlugin(name = "OrderAlarm")
public class OrderAlarmPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        String title = call.getString("title", "New order");
        String body = call.getString("body", "Open the app to accept or reject");
        AlarmService.start(getContext(), title, body);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        AlarmService.clearPending(getContext());
        AlarmService.stop(getContext());
        call.resolve();
    }

    @PluginMethod
    public void getToken(PluginCall call) {
        try {
            FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
                if (task.isSuccessful() && task.getResult() != null) {
                    JSObject ret = new JSObject();
                    ret.put("token", task.getResult());
                    call.resolve(ret);
                } else {
                    call.reject("Could not get push token (is google-services.json in android/app?)");
                }
            });
        } catch (Exception e) {
            call.reject("Firebase is not set up: add android/app/google-services.json", e);
        }
    }

    @PluginMethod
    public void status(PluginCall call) {
        Context ctx = getContext();
        JSObject ret = new JSObject();
        ret.put("notifications", NotificationManagerCompat.from(ctx).areNotificationsEnabled());
        boolean fullScreen = true;
        if (Build.VERSION.SDK_INT >= 34) {
            fullScreen = ctx.getSystemService(NotificationManager.class).canUseFullScreenIntent();
        }
        ret.put("fullScreen", fullScreen);
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        ret.put("batteryOptimized", !pm.isIgnoringBatteryOptimizations(ctx.getPackageName()));
        ret.put("ringing", AlarmService.ringing);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getActivity() != null) {
            ActivityCompat.requestPermissions(getActivity(), new String[]{Manifest.permission.POST_NOTIFICATIONS}, 4201);
        }
        call.resolve();
    }

    @PluginMethod
    public void openFullScreenSettings(PluginCall call) {
        Intent i;
        if (Build.VERSION.SDK_INT >= 34) {
            i = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + getContext().getPackageName()));
        } else {
            i = appDetails();
        }
        launch(i);
        call.resolve();
    }

    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getContext().getPackageName()));
        launch(i);
        call.resolve();
    }

    private Intent appDetails() {
        return new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
    }

    private void launch(Intent i) {
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(i);
        } catch (Exception e) {
            Intent fallback = appDetails().addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(fallback);
        }
    }
}
