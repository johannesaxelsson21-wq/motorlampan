// Låtsasscanner för webbförhandsvisningen (npx expo start --web).
// Välj scenario med ?demo=… i adressen:
//   (inget)  två felkoder som raderas      none   ingen scanner hittas
//   0        inga felkoder                 pick   flera scannrar att välja mellan
//   fail     bilen svarar inte             back   felet kommer tillbaka direkt
import { FriendlyError, Found } from "./types";
export { FriendlyError, type Found };

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const mode = () => {
  try { return new URLSearchParams(window.location.search).get("demo") ?? ""; } catch { return ""; }
};

export async function waitForBluetooth() { await sleep(300); }

export async function scan(showAll: boolean): Promise<Found[]> {
  await sleep(1500);
  if (mode() === "none" && !showAll) return [];
  if (mode() === "pick" || showAll)
    return [{ id: "a", name: "OBDII" }, { id: "b", name: "JBL Flip 5" }, { id: "c", name: "Vgate iCar Pro" }];
  return [{ id: "a", name: "OBDII" }];
}

export class Elm {
  private cleared = false;
  async connect(_id: string) { await sleep(900); }
  async send(cmd: string): Promise<string> {
    await sleep(cmd === "0100" ? 1400 : 350);
    const m = mode();
    if (cmd === "0100") return m === "fail" ? "SEARCHING...\rUNABLE TO CONNECT\r" : "SEARCHING...\r4100BE3EB813\r";
    if (cmd === "ATDPN") return "A6\r";
    if (cmd === "03") {
      if (m === "0" || (this.cleared && m !== "back")) return "4300\r";
      return "008\r0:430302990234\r1:24360000000000\r";
    }
    if (cmd === "04") { this.cleared = true; return "44\r"; }
    return "OK\r";
  }
  async disconnect() {}
}
