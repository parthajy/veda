package com.useveda.app;

import android.os.Bundle;
import android.webkit.GeolocationPermissions;
import android.webkit.WebChromeClient;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    // Enable JS + Geolocation
    bridge.getWebView().getSettings().setJavaScriptEnabled(true);
    bridge.getWebView().getSettings().setGeolocationEnabled(true);

    // Auto-approve location requests from WebView
    bridge.getWebView().setWebChromeClient(new WebChromeClient() {
      @Override
      public void onGeolocationPermissionsShowPrompt(
        String origin,
        GeolocationPermissions.Callback callback
      ) {
        callback.invoke(origin, true, false);
      }
    });
  }
}
