package com.juicysukun.admin;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.speech.tts.TextToSpeech;
import androidx.core.app.NotificationCompat;
import java.util.Locale;
import java.util.HashSet;
import java.util.Set;

/**
 * Plays a loud looping alarm (on the ALARM audio stream, so it rings even in silent mode)
 * until it is stopped. Started by a push message ({@link OrderMessagingService}) or by the web app.
 */
public class AlarmService extends Service {
    static final String ACTION_START = "com.juicysukun.admin.ALARM_START";
    static final String ACTION_STOP = "com.juicysukun.admin.ALARM_STOP";
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_BODY = "body";
    static final String CHANNEL_ID = "order_alarm";
    private static final int NOTIFICATION_ID = 4201;
    private static final String PREFS = "alarm";
    private static final String KEY_PENDING = "pending_ids";

    static volatile boolean ringing = false;

    private MediaPlayer player;
    private MediaPlayer voicePlayer;
    private PowerManager.WakeLock wakeLock;
    private Vibrator vibrator;
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private final Handler handler = new Handler(Looper.getMainLooper());
    /** Speaks "New order" again every few seconds, slowly, until the alarm is stopped. */
    private final Runnable speakLoop = new Runnable() {
        @Override public void run() {
            if (!ringing) return;
            speak();
            handler.postDelayed(this, voiceIntervalMs());
        }
    };
    /** Plays the recorded "New order received" clip, then waits and plays it again until the alarm is stopped. */
    private final Runnable voiceLoop = new Runnable() {
        @Override public void run() {
            if (!ringing) return;
            playRecordedOnce();
        }
    };

    // ---- voice settings (written by AlarmVoicePlugin from the Settings screen) ---------------

    static final String VOICE_PREFS = "alarm_voice";
    static final String KEY_MODE = "mode";          // "recorded" (default) | "phone" | "bell"
    static final String KEY_INTERVAL = "interval";  // seconds between repeats

    private String voiceMode() {
        String m = getSharedPreferences(VOICE_PREFS, MODE_PRIVATE).getString(KEY_MODE, "recorded");
        return "phone".equals(m) || "bell".equals(m) ? m : "recorded";
    }

    private long voiceIntervalMs() {
        int s = getSharedPreferences(VOICE_PREFS, MODE_PRIVATE).getInt(KEY_INTERVAL, 3);
        return Math.max(2, Math.min(15, s)) * 1000L;
    }

    // ---- helpers used by the plugin and the push service ------------------------------------

    static void start(Context ctx, String title, String body) {
        Intent i = new Intent(ctx, AlarmService.class).setAction(ACTION_START).putExtra(EXTRA_TITLE, title).putExtra(EXTRA_BODY, body);
        if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i);
        else ctx.startService(i);
    }

    static void stop(Context ctx) {
        ctx.stopService(new Intent(ctx, AlarmService.class));
        ringing = false;
    }

    /** Remembers which orders are waiting so one expiring order doesn't silence another that is still waiting. */
    static synchronized void addPending(Context ctx, String orderId) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, MODE_PRIVATE);
        Set<String> s = new HashSet<>(p.getStringSet(KEY_PENDING, new HashSet<>()));
        s.add(orderId);
        p.edit().putStringSet(KEY_PENDING, s).apply();
    }

    /** @return how many orders are still waiting after removing this one. */
    static synchronized int removePending(Context ctx, String orderId) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, MODE_PRIVATE);
        Set<String> s = new HashSet<>(p.getStringSet(KEY_PENDING, new HashSet<>()));
        s.remove(orderId);
        p.edit().putStringSet(KEY_PENDING, s).apply();
        return s.size();
    }

    static synchronized void clearPending(Context ctx) {
        ctx.getSharedPreferences(PREFS, MODE_PRIVATE).edit().remove(KEY_PENDING).apply();
    }

    // ---- service ----------------------------------------------------------------------------

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        String title = intent != null && intent.getStringExtra(EXTRA_TITLE) != null ? intent.getStringExtra(EXTRA_TITLE) : "New order";
        String body = intent != null && intent.getStringExtra(EXTRA_BODY) != null ? intent.getStringExtra(EXTRA_BODY) : "Open the app to accept or reject";

        createChannel();
        Notification n = buildNotification(title, body);
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, n);
        }

        if (!ringing) {
            ringing = true;
            acquireWakeLock();
            setAlarmVolume();
            vibrate();
            String mode = voiceMode();
            if ("bell".equals(mode)) playAlarm();
            else if ("phone".equals(mode)) startVoice(); // the phone's own voice says "New order"; the bell is the fallback
            else playRecordedOnce(); // our recorded "New order received" clip
        }
        return START_STICKY;
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "New order alarm", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Rings loudly until you accept or reject a new order");
        ch.setSound(null, null); // the sound is played by MediaPlayer on the alarm stream
        ch.enableVibration(false);
        ch.setBypassDnd(true);
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(ch);
    }

    private Notification buildNotification(String title, String body) {
        Intent open = new Intent(this, MainActivity.class).putExtra("open_new", true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, flags);
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setContentTitle(title)
                .setContentText(body)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .setContentIntent(pi)
                .setFullScreenIntent(pi, true)
                .build();
    }

    private void acquireWakeLock() {
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "juicysukun:alarm");
        wakeLock.acquire(60 * 60 * 1000L); // safety net: never longer than an hour
    }

    private void setAlarmVolume() {
        try {
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            am.setStreamVolume(AudioManager.STREAM_ALARM, Math.max(1, Math.round(am.getStreamMaxVolume(AudioManager.STREAM_ALARM) * 1.0f)), 0);
        } catch (Exception ignored) { }
    }

    private void playAlarm() {
        if (player != null) return;
        try {
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            player = MediaPlayer.create(this, R.raw.order_alarm,
                    new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ALARM)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build(),
                    am.generateAudioSessionId());
            if (player != null) {
                player.setLooping(true);
                player.setVolume(1.0f, 1.0f);
                player.start();
            }
        } catch (Exception e) {
            // Even if audio fails, the vibration and full-screen notification still alert the owner.
        }
    }

    private void playRecordedOnce() {
        try {
            if (voicePlayer != null) { try { voicePlayer.release(); } catch (Exception ignored) { } voicePlayer = null; }
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            voicePlayer = MediaPlayer.create(this, R.raw.order_voice,
                    new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ALARM)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build(),
                    am.generateAudioSessionId());
            if (voicePlayer == null) { playAlarm(); return; }
            voicePlayer.setVolume(1.0f, 1.0f);
            voicePlayer.setOnCompletionListener(mp -> {
                if (ringing) handler.postDelayed(voiceLoop, Math.max(500L, voiceIntervalMs() - 1400L));
            });
            voicePlayer.start();
        } catch (Exception e) {
            playAlarm(); // the bell is the safety net
        }
    }

    private void startVoice() {
        try {
            tts = new TextToSpeech(getApplicationContext(), status -> {
                if (status != TextToSpeech.SUCCESS || tts == null) { if (ringing) playAlarm(); return; }
                int r = tts.setLanguage(new Locale("en", "IN"));
                if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) tts.setLanguage(Locale.US);
                tts.setSpeechRate(0.95f);  // clear, a bit quicker than before (was 0.7)
                tts.setPitch(0.95f);
                tts.setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build());
                ttsReady = true;
                handler.postDelayed(speakLoop, 300);
            });
        } catch (Exception ignored) {
            playAlarm(); // no speech engine: fall back to the bell
        }
    }

    private void speak() {
        if (!ttsReady || tts == null) return;
        try {
            Bundle b = new Bundle();
            b.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 1f);
            tts.speak("New order.", TextToSpeech.QUEUE_FLUSH, b, "neworder");
        } catch (Exception ignored) { }
    }

    private void vibrate() {
        try {
            vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            long[] pattern = {0, 800, 400};
            if (Build.VERSION.SDK_INT >= 26) vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
            else vibrator.vibrate(pattern, 0);
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onDestroy() {
        ringing = false;
        handler.removeCallbacksAndMessages(null);
        if (tts != null) {
            try { tts.stop(); tts.shutdown(); } catch (Exception ignored) { }
            tts = null;
        }
        if (voicePlayer != null) {
            try { voicePlayer.stop(); } catch (Exception ignored) { }
            voicePlayer.release();
            voicePlayer = null;
        }
        if (player != null) {
            try { player.stop(); } catch (Exception ignored) { }
            player.release();
            player = null;
        }
        if (vibrator != null) vibrator.cancel();
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
