import { chromium } from "playwright";
import { existsSync } from "node:fs";

export function launchBrowser() {
  const executablePath =
    process.env.CHROME_PATH ||
    (process.platform === "win32"
      ? [
          "C:/Program Files/Google/Chrome/Application/chrome.exe",
          "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
        ].find(existsSync)
      : undefined);
  return chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
}
