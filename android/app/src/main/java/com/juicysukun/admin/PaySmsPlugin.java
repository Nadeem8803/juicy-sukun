package com.juicysukun.admin;

import android.Manifest;
import android.database.Cursor;
import android.net.Uri;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Lets the owner app read recent SMS (only to find bank "credited" messages and match them to unpaid orders).
 * Nothing is uploaded or stored: the messages are read on the phone and checked by the app.
 */
@CapacitorPlugin(
        name = "PaySms",
        permissions = {@Permission(strings = {Manifest.permission.READ_SMS, Manifest.permission.RECEIVE_SMS}, alias = "sms")})
public class PaySmsPlugin extends Plugin {
    private static PaySmsPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    static void ping() {
        if (instance != null) instance.notifyListeners("smsReceived", new JSObject());
    }

    @PluginMethod
    public void access(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", getPermissionState("sms") == PermissionState.GRANTED);
        call.resolve(r);
    }

    @PluginMethod
    public void requestAccess(PluginCall call) {
        if (getPermissionState("sms") == PermissionState.GRANTED) {
            access(call);
            return;
        }
        requestPermissionForAlias("sms", call, "afterPermission");
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) {
        access(call);
    }

    /** SMS received in the last `minutes` minutes, newest first (at most 60). */
    @PluginMethod
    public void recent(PluginCall call) {
        if (getPermissionState("sms") != PermissionState.GRANTED) {
            call.reject("sms_permission");
            return;
        }
        int minutes = Math.max(1, Math.min(24 * 60, call.getInt("minutes", 180)));
        long since = System.currentTimeMillis() - minutes * 60_000L;
        JSArray out = new JSArray();
        try (Cursor c = getContext().getContentResolver().query(
                Uri.parse("content://sms/inbox"),
                new String[]{"address", "body", "date"},
                "date > ?",
                new String[]{String.valueOf(since)},
                "date DESC LIMIT 60")) {
            if (c != null) {
                while (c.moveToNext()) {
                    JSObject m = new JSObject();
                    m.put("sender", c.getString(0));
                    m.put("body", c.getString(1));
                    m.put("date", c.getLong(2));
                    out.put(m);
                }
            }
        } catch (Exception e) {
            call.reject("sms_read_failed");
            return;
        }
        JSObject r = new JSObject();
        r.put("messages", out);
        call.resolve(r);
    }
}
