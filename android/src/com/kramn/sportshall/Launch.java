package com.kramn.sportshall;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

// Opens the live game in the Quest Browser and closes straight away.
public class Launch extends Activity {
    static final String URL = "https://doublehb.github.io/sportshall/";

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse(URL));
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        open.setPackage("com.oculus.browser");
        try {
            startActivity(open);
        } catch (ActivityNotFoundException e) {
            // Not a Quest (or no Quest Browser): any browser will do.
            open.setPackage(null);
            try { startActivity(open); } catch (ActivityNotFoundException ignored) { }
        }
        finish();
    }
}
