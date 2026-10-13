import { readInstallRecord } from "./claude-config.js";
import { install } from "./install.js";
import { log } from "./shell.js";

/**
 * Re-run the installer against the latest package. Dev installs (packed from a
 * checkout) are re-packed from that checkout; registry installs pull `latest`.
 */
export async function upgrade(): Promise<number> {
  const rec = readInstallRecord();
  if (!rec) {
    log.warn("no previous install found; running a fresh install");
    return install({ yes: true });
  }
  const spec =
    rec.fromSpec.startsWith("pack:") || rec.fromSpec === "self" ? undefined : "eminiar@latest";
  return install({ yes: true, method: rec.method, noModel: false, spec, node: rec.node });
}
