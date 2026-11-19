package com.juicysukun.admin;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

/**
 * Receives the high-priority data message sent by the Cloud Function and rings the alarm,
 * even when the app is closed or the phone is locked.
 *   type=new_order    -> start ringing
 *   type=order_closed -> stop ringing once no order is waiting any more
 */
public class OrderMessagingService extends FirebaseMessagingService {
    @Override
    public void onMessageReceived(RemoteMessage message) {
        Map<String, String> data = message.getData();
        String type = data.get("type");
        String orderId = data.get("orderId") != null ? data.get("orderId") : "";
        if ("new_order".equals(type)) {
            AlarmService.addPending(this, orderId);
            String number = data.get("number") != null ? data.get("number") : "";
            String total = data.get("total") != null ? " · ₹" + data.get("total") : "";
            AlarmService.start(this, "New order " + number + total, "Open the app to accept or reject");
        } else if ("order_closed".equals(type)) {
            if (AlarmService.removePending(this, orderId) <= 0) AlarmService.stop(this);
        }
    }

    @Override
    public void onNewToken(String token) {
        // The web app reads the current token on every start and saves it to Firestore.
    }
}
