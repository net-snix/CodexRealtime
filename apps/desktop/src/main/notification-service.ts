import { Notification } from "electron";
import type { DesktopNotificationRequest } from "@shared";

class AppNotificationService {
  show(request: DesktopNotificationRequest) {
    if (!Notification.isSupported()) {
      return false;
    }

    new Notification({
      title: request.title,
      body: request.body
    }).show();

    return true;
  }
}

export const appNotificationService = new AppNotificationService();
