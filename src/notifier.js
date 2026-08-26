import { execFile } from "node:child_process";

function escapeAppleScript(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export function notify(title, message, sound = "Glass") {
  if (process.platform !== "darwin") return;
  const script = `display notification "${escapeAppleScript(message)}" with title "${escapeAppleScript(title)}" sound name "${escapeAppleScript(sound)}"`;
  execFile("/usr/bin/osascript", ["-e", script], () => {});
}
