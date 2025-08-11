# SilentPushTracker Vercel

SwiftUI app that counts silent push notifications.

## Setup

1. Enable capabilities in Xcode:
   - Push Notifications
   - Background Modes → Remote notifications

2. Run on a real device (not simulator).

3. Copy the device token from Xcode logs.

4. Use your backend (e.g. Vercel or Postman) to send a silent push:
   {
     "aps": {
       "content-available": 1
     }
   }

5. App increments the counter shown in ContentView each time a silent push is received.