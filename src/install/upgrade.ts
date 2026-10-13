import { readInstallRecord } from "./claude-config.js";
import { install } from "./install.js";
import { log } from "./shell.js";

/**
 * Re-run the installer against the latest package. Dev installs (packed from a
 * checkout) are re-packed from that checkout even when the version number has not
 * changed; registry installs pull `latest`. Previous choices (statusline) are kept.
 */
export async function upgrade(): Promise<number> {
  const rec = readInstallRecord();
  if (!rec) {
    log.warn("no previous install found; running a fresh install");
    return install({ yes: true });
  }
  const fromCheckout = rec.fromSpec.startsWith("pack:") || rec.fromSpec === "self";
  return install({
    yes: true,
    method: rec.method,
    noModel: false,
    spec: fromCheckout ? undefined : "eminiar@latest",
    force: fromCheckout,
    node: rec.node,
    statusline: !!rec.wrote.statusline,
  });
}
