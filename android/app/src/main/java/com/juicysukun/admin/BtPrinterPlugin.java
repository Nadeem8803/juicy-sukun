package com.juicysukun.admin;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.os.Build;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.OutputStream;
import java.util.Set;
import java.util.UUID;

/**
 * Bluetooth thermal printer bridge (ESC/POS over classic Bluetooth SPP).
 * JavaScript: window.Capacitor.Plugins.BtPrinter -> list() and print({ address, data(base64) }).
 * The printer must first be paired in Android Settings -> Bluetooth (PIN is usually 0000 or 1234).
 */
@CapacitorPlugin(
        name = "BtPrinter",
        permissions = {@Permission(strings = {Manifest.permission.BLUETOOTH_CONNECT}, alias = "bt")})
public class BtPrinterPlugin extends Plugin {
    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final Object LOCK = new Object();

    private boolean needsPermission() {
        return Build.VERSION.SDK_INT >= 31 && getPermissionState("bt") != PermissionState.GRANTED;
    }

    @PluginMethod
    public void list(PluginCall call) {
        if (needsPermission()) {
            requestPermissionForAlias("bt", call, "listPerm");
            return;
        }
        doList(call);
    }

    @PermissionCallback
    private void listPerm(PluginCall call) {
        if (needsPermission()) call.reject("Bluetooth permission was not allowed. Allow 'Nearby devices' for this app.");
        else doList(call);
    }

    @SuppressLint("MissingPermission")
    private void doList(PluginCall call) {
        try {
            BluetoothAdapter adapter = adapter();
            if (adapter == null) { call.reject("This phone has no Bluetooth."); return; }
            if (!adapter.isEnabled()) { call.reject("Bluetooth is off. Switch it on and try again."); return; }
            JSArray devices = new JSArray();
            Set<BluetoothDevice> bonded = adapter.getBondedDevices();
            if (bonded != null) {
                for (BluetoothDevice d : bonded) {
                    JSObject o = new JSObject();
                    o.put("name", d.getName() != null ? d.getName() : d.getAddress());
                    o.put("address", d.getAddress());
                    devices.put(o);
                }
            }
            JSObject ret = new JSObject();
            ret.put("devices", devices);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not read paired devices: " + e.getMessage());
        }
    }

    @PluginMethod
    public void print(PluginCall call) {
        if (needsPermission()) {
            requestPermissionForAlias("bt", call, "printPerm");
            return;
        }
        doPrint(call);
    }

    @PermissionCallback
    private void printPerm(PluginCall call) {
        if (needsPermission()) call.reject("Bluetooth permission was not allowed. Allow 'Nearby devices' for this app.");
        else doPrint(call);
    }

    private void doPrint(PluginCall call) {
        final String address = call.getString("address");
        final String data = call.getString("data");
        if (address == null || address.isEmpty()) { call.reject("No printer chosen."); return; }
        if (data == null || data.isEmpty()) { call.reject("Nothing to print."); return; }
        final byte[] bytes;
        try {
            bytes = Base64.decode(data, Base64.DEFAULT);
        } catch (Exception e) {
            call.reject("Bad print data.");
            return;
        }
        // Bluetooth I/O blocks, so do it off the main thread.
        new Thread(() -> {
            synchronized (LOCK) {
                try {
                    send(address, bytes);
                    call.resolve();
                } catch (Exception e) {
                    call.reject(e.getMessage() != null ? e.getMessage() : "Print failed");
                }
            }
        }, "bt-print").start();
    }

    @SuppressLint("MissingPermission")
    private void send(String address, byte[] bytes) throws Exception {
        BluetoothAdapter adapter = adapter();
        if (adapter == null) throw new Exception("This phone has no Bluetooth.");
        if (!adapter.isEnabled()) throw new Exception("Bluetooth is off.");
        BluetoothDevice device = adapter.getRemoteDevice(address);
        try { adapter.cancelDiscovery(); } catch (Exception ignored) { }

        BluetoothSocket socket = null;
        try {
            socket = device.createRfcommSocketToServiceRecord(SPP);
            socket.connect();
        } catch (Exception first) {
            // Some cheap printers only accept the older fixed-channel connection.
            try { if (socket != null) socket.close(); } catch (Exception ignored) { }
            socket = (BluetoothSocket) device.getClass().getMethod("createRfcommSocket", int.class).invoke(device, 1);
            socket.connect();
        }
        try {
            OutputStream out = socket.getOutputStream();
            int chunk = 512;
            for (int i = 0; i < bytes.length; i += chunk) {
                out.write(bytes, i, Math.min(chunk, bytes.length - i));
                out.flush();
                Thread.sleep(25); // small printers have tiny buffers
            }
            Thread.sleep(400); // let the last bytes leave before closing
        } finally {
            try { socket.close(); } catch (Exception ignored) { }
        }
    }

    private BluetoothAdapter adapter() {
        BluetoothManager m = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        return m != null ? m.getAdapter() : null;
    }
}
