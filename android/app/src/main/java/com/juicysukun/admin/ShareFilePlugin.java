package com.juicysukun.admin;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.core.content.FileProvider;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;

/**
 * Sends a PDF (the invoice) straight to WhatsApp. With a phone number (country code, digits only)
 * the chat with that customer opens directly; without one WhatsApp asks who to send it to.
 * If WhatsApp is not installed the normal Android share sheet opens instead.
 * JavaScript: window.Capacitor.Plugins.ShareFile.sharePdf({ fileName, data(base64), text, phone, mime, chooser }).
 */
@CapacitorPlugin(name = "ShareFile")
public class ShareFilePlugin extends Plugin {

    @PluginMethod
    public void sharePdf(PluginCall call) {
        String data = call.getString("data");
        if (data == null || data.isEmpty()) { call.reject("No invoice to send."); return; }
        String name = call.getString("fileName", "invoice.pdf").replaceAll("[^A-Za-z0-9._-]", "_");
        String text = call.getString("text", "");
        String phone = call.getString("phone");
        String mime = call.getString("mime", "application/pdf");
        boolean chooser = Boolean.TRUE.equals(call.getBoolean("chooser", false));
        try {
            File dir = new File(getContext().getCacheDir(), "invoices");
            if (!dir.exists() && !dir.mkdirs()) throw new Exception("Cannot create the invoice folder.");
            File file = new File(dir, name);
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(Base64.decode(data, Base64.DEFAULT));
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);

            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mime);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            if (text != null && !text.isEmpty()) send.putExtra(Intent.EXTRA_TEXT, text);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            if (phone != null && !phone.isEmpty()) send.putExtra("jid", phone + "@s.whatsapp.net");

            for (String pkg : chooser ? new String[]{} : new String[]{"com.whatsapp", "com.whatsapp.w4b"}) {
                try {
                    send.setPackage(pkg);
                    getActivity().startActivity(send);
                    call.resolve();
                    return;
                } catch (ActivityNotFoundException ignored) {
                    // try the next WhatsApp flavour
                }
            }
            send.setPackage(null);
            send.removeExtra("jid");
            getActivity().startActivity(Intent.createChooser(send, "Share"));
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "Could not share the invoice");
        }
    }
}
