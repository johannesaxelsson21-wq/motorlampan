// Bluetooth LE-anslutning till en ELM327-scanner (iPhone/Android).
// I webbförhandsvisningen används ble.web.ts i stället.
import { BleManager, Device, Characteristic, Subscription } from "react-native-ble-plx";
import { FriendlyError, Found } from "./types";
export { FriendlyError, type Found };

const full = (s: string) => `0000${s}-0000-1000-8000-00805f9b34fb`;
// Vanliga BLE-tjänster för ELM327-kloner, Vgate, vLinker, OBDLink m.fl.
export const KNOWN_SERVICES = [
  full("fff0"), full("ffe0"), full("18f0"),
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
  "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
];
const NAME_RE = /obd|v-?link|vgate|veepeak|konnwei|viecar|elm|icar|lelink|carista|ancel|topdon|scan/i;

export const manager = new BleManager();

export async function waitForBluetooth(): Promise<void> {
  let state = await manager.state();
  if (state === "Unknown" || state === "Resetting") {
    state = await new Promise(res => {
      const sub = manager.onStateChange(s => {
        if (s !== "Unknown" && s !== "Resetting") { sub.remove(); res(s); }
      }, true);
      setTimeout(() => { sub.remove(); res(state); }, 4000);
    });
  }
  if (state === "PoweredOn") return;
  if (state === "Unauthorized")
    throw new FriendlyError("Appen behöver Bluetooth",
      "Öppna Inställningar, tryck på Motorlampan och slå på Bluetooth. Kom sedan tillbaka hit och tryck på knappen nedan.");
  throw new FriendlyError("Slå på Bluetooth",
    "Svep ner från övre högra hörnet och tryck på Bluetooth-symbolen så att den blir blå. Tryck sedan på knappen nedan.");
}

/** Söker efter scannrar i några sekunder. showAll = visa alla enheter med namn. */
export function scan(showAll: boolean, ms = 6000): Promise<Found[]> {
  return new Promise(resolve => {
    const found = new Map<string, Found>();
    manager.startDeviceScan(null, { allowDuplicates: false }, (err, d) => {
      if (err || !d) return;
      const name = d.name || d.localName || "";
      const svcMatch = (d.serviceUUIDs || []).some(u => KNOWN_SERVICES.includes(u.toLowerCase()));
      if (showAll ? !!name : (svcMatch || NAME_RE.test(name)))
        found.set(d.id, { id: d.id, name: name || "Okänd scanner" });
    });
    setTimeout(() => { manager.stopDeviceScan(); resolve([...found.values()]); }, ms);
  });
}

export class Elm {
  private device!: Device;
  private svc = ""; private rx = ""; private tx = ""; private noResp = true;
  private sub?: Subscription;
  private buf = "";
  private waiter: ((s: string) => void) | null = null;

  async connect(id: string) {
    try {
      this.device = await manager.connectToDevice(id, { timeout: 10000 });
    } catch {
      throw new FriendlyError("Vi hittar inte scannern än",
        "Det brukar lösa sig direkt. Tryck in scannern ordentligt och vrid om nyckeln till tändning på. Tryck sedan på knappen nedan, så letar vi igen.",
        "search");
    }
    await this.device.discoverAllServicesAndCharacteristics();
    const services = await this.device.services();
    services.sort((a, b) => rank(a.uuid) - rank(b.uuid));
    for (const s of services) {
      const chars = await s.characteristics();
      const n = chars.find(c => c.isNotifiable || c.isIndicatable);
      const w = chars.find(c => c.isWritableWithoutResponse) || chars.find(c => c.isWritableWithResponse);
      if (n && w) {
        this.svc = s.uuid; this.rx = n.uuid; this.tx = w.uuid; this.noResp = w.isWritableWithoutResponse;
        this.sub = this.device.monitorCharacteristicForService(this.svc, this.rx, (err, c) => {
          if (!err && c) this.onData(c);
        });
        return;
      }
    }
    throw new FriendlyError("Det där var nog inte scannern",
      "Inga problem. Tryck på knappen nedan och välj en annan i listan.",
      "pick");
  }

  private onData(c: Characteristic) {
    if (!c.value) return;
    this.buf += atob(c.value);
    const i = this.buf.indexOf(">");
    if (i >= 0 && this.waiter) {
      const r = this.buf.slice(0, i); this.buf = "";
      const w = this.waiter; this.waiter = null; w(r);
    }
  }

  send(cmd: string, timeout = 5000): Promise<string> {
    this.buf = "";
    return new Promise<string>((resolve, reject) => {
      this.waiter = resolve;
      setTimeout(() => {
        if (this.waiter === resolve) { this.waiter = null; reject(new Error("timeout:" + cmd)); }
      }, timeout);
      const data = btoa(cmd + "\r");
      const write = this.noResp
        ? this.device.writeCharacteristicWithoutResponseForService(this.svc, this.tx, data)
        : this.device.writeCharacteristicWithResponseForService(this.svc, this.tx, data);
      write.catch(e => { if (this.waiter === resolve) { this.waiter = null; reject(e); } });
    });
  }

  async disconnect() {
    try { this.sub?.remove(); } catch {}
    try { if (this.device) await manager.cancelDeviceConnection(this.device.id); } catch {}
  }
}

function rank(uuid: string) {
  const i = KNOWN_SERVICES.indexOf(uuid.toLowerCase());
  return i < 0 ? 99 : i;
}
