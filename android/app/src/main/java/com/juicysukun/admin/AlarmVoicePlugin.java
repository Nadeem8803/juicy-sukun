package com.juicysukun.admin;

import android.content.Context;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Settings → Order alarm & voice: which sound the alarm uses and how often it repeats. */
@CapacitorPlugin(name = "AlarmVoice")
public class AlarmVoicePlugin extends Plugin {
    @PluginMethod
    public void setVoice(PluginCall call) {
        String mode = call.getString("mode", "recorded");
        int interval = call.getInt("interval", 3);
        getContext().getSharedPreferences(AlarmService.VOICE_PREFS, Context.MODE_PRIVATE).edit()
                .putString(AlarmService.KEY_MODE, mode)
                .putInt(AlarmService.KEY_INTERVAL, interval)
                .apply();
        call.resolve();
    }
}
