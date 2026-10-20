// The settings page's entry: one port to the service worker, which only
// serves ports from this page (`SettingsHub.accept`).
import { PORT_NAME } from "../settings";
import { SettingsPage, type PagePort } from "./page";

const root = document.getElementById("app");
if (root) new SettingsPage(root, chrome.runtime.connect({ name: PORT_NAME }) as unknown as PagePort);
