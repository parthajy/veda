import { PushNotifications } from "@capacitor/push-notifications";
import { supabase } from "./supabase";

export async function initPush() {
  try {
    const perm = await PushNotifications.requestPermissions();
    if (perm.receive !== "granted") return;

    await PushNotifications.register();

    PushNotifications.addListener("registration", async (token) => {
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) return;

      await supabase.from("device_tokens").upsert(
        {
          profile_id: user.id,
          platform: "android",
          token: token.value,
        },
        { onConflict: "profile_id,token" }
      );
    });
  } catch (e) {
    // ignore for web browser dev
  }
}
