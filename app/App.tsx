import { ReactNode, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Animated, Easing, Platform, Pressable, ScrollView, StyleSheet, Text, View, useColorScheme,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import * as Haptics from "expo-haptics";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Elm, Found, FriendlyError, scan, waitForBluetooth } from "./src/ble";
import type { Retry } from "./src/types";
import { answered0100, clearedOk, codeInfo, parseDTCs, protocolIsCan } from "./src/obd";

/* ------------------------------------------------------------------ */
/*  Typer och små hjälpare                                             */
/* ------------------------------------------------------------------ */

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

type Screen =
  | { kind: "idle" }
  | { kind: "work"; step: number }
  | { kind: "pick"; list: Found[] }
  | { kind: "ok" | "calm"; title: string; text: string; icon?: IconName; codes?: string[]; retry?: Retry };

type HistItem = { t: string; codes: string[]; left: string[]; note?: string };

const STEPS: { label: string; icon: IconName }[] = [
  { label: "Ansluter till scannern", icon: "bluetooth" },
  { label: "Pratar med bilen", icon: "car" },
  { label: "Tittar vad bilen sparat", icon: "magnify" },
  { label: "Släcker lampan", icon: "lightbulb-off-outline" },
];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const native = Platform.OS !== "web";

async function load<T>(k: string, d: T): Promise<T> {
  try { const v = await AsyncStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; }
}
async function save(k: string, v: unknown) {
  try { await AsyncStorage.setItem(k, JSON.stringify(v)); } catch {}
}
function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "God natt";
  if (h < 10) return "God morgon";
  if (h < 18) return "Hej";
  return "God kväll";
}
function vibrate(kind: "ok" | "calm") {
  if (!native) return;
  // Glad vibration när det gick bra, bara en mjuk knackning annars.
  (kind === "ok"
    ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)).catch(() => {});
}
async function addHistory(item: HistItem) {
  const hist = await load<HistItem[]>("history", []);
  hist.unshift(item);
  await save("history", hist.slice(0, 50));
}

/* ------------------------------------------------------------------ */
/*  Appen                                                              */
/* ------------------------------------------------------------------ */

export default function App() {
  return <SafeAreaProvider><Main /></SafeAreaProvider>;
}

function Main() {
  const dark = useColorScheme() === "dark";
  const c = dark ? darkColors : lightColors;
  const s = makeStyles(c);
  const insets = useSafeAreaInsets();
  const [screen, setScreen] = useState<Screen>({ kind: "idle" });
  const [history, setHistory] = useState<HistItem[] | null>(null);
  const busy = useRef(false);

  const step = (n: number) => setScreen({ kind: "work", step: n });
  const finish = (sc: Extract<Screen, { kind: "ok" | "calm" }>) => { vibrate(sc.kind); setScreen(sc); };

  async function guarded(fn: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    setHistory(null);
    activateKeepAwakeAsync().catch(() => {});
    try { await fn(); }
    catch (e: any) {
      if (e instanceof FriendlyError)
        finish({ kind: "calm", title: e.title, text: e.text, retry: e.retry, icon: "refresh" });
      else {
        // Tekniska detaljer visas inte för mamma, men sparas i historiken för den som hjälper till.
        addHistory({ t: new Date().toISOString(), codes: [], left: [], note: String(e?.message ?? e) });
        finish({ kind: "calm", title: "Vi tar det en gång till", icon: "refresh", retry: "again",
          text: "Ibland behöver scannern bara ett nytt försök. Kolla gärna att den sitter i och att Bluetooth är på, och tryck sedan på knappen nedan." });
      }
    } finally {
      busy.current = false;
      deactivateKeepAwake();
    }
  }

  /** Huvudknappen. pickNew = sök efter en ny scanner i stället för den sparade. */
  const start = (pickNew = false, showAll = false) => guarded(async () => {
    step(0);
    await waitForBluetooth();
    const saved = pickNew ? null : await load<Found | null>("device", null);
    if (saved) return runObd(saved);

    const list = await scan(showAll);
    if (list.length === 1) return runObd(list[0]);
    if (list.length > 1) { setScreen({ kind: "pick", list }); return; }
    throw new FriendlyError("Vi hittar inte scannern än",
      "Det brukar lösa sig direkt. Tryck in scannern ordentligt och vrid om nyckeln till tändning på. Tryck sedan på knappen nedan, så letar vi igen.",
      "search");
  });

  const pick = (d: Found) => guarded(() => runObd(d));

  async function runObd(dev: Found) {
    const elm = new Elm();
    try {
      step(0);
      await elm.connect(dev.id);
      await save("device", dev);
      try { await elm.send("ATZ", 4000); } catch {}
      await sleep(300);
      for (const cmd of ["ATE0", "ATL0", "ATS0", "ATH0", "ATSP0"]) { try { await elm.send(cmd, 3000); } catch {} }

      step(1);
      let r = "";
      try { r = await elm.send("0100", 15000); } catch { r = "UNABLE TO CONNECT"; }
      if (!answered0100(r))
        throw new FriendlyError("Bilen behöver vakna",
          "Vrid om nyckeln till tändning på, så att lamporna på instrumentbrädan tänds. Tryck sedan på knappen nedan, så fortsätter vi.");

      let isCan: boolean | undefined;
      try { isCan = protocolIsCan(await elm.send("ATDPN", 3000)); } catch {}

      step(2);
      const before = parseDTCs(await elm.send("03", 10000), isCan);

      step(3);
      if (!clearedOk(await elm.send("04", 10000)))
        throw new FriendlyError("Nästan klart",
          "Stäng av motorn men låt tändningen vara på. Tryck sedan på knappen nedan, så gör vi färdigt.");
      await sleep(800);
      let after: string[] = [];
      try { after = parseDTCs(await elm.send("03", 10000), isCan); } catch {}

      await addHistory({ t: new Date().toISOString(), codes: before, left: after });

      if (after.length)
        finish({ kind: "calm", icon: "wrench-outline", title: "Dags för en liten översyn",
          text: "Bilen vill gärna att en verkstad tittar på den. Ingen fara, boka en tid när det passar dig. Här nedanför ser du vad det brukar vara.",
          codes: after });
      else if (before.length)
        finish({ kind: "ok", title: "Klart! Bra jobbat.",
          text: "Motorlampan är släckt.\nStäng av bilen, vänta 10 sekunder och starta igen. Sedan är allt som vanligt.", codes: before });
      else
        finish({ kind: "ok", title: "Allt ser bra ut",
          text: "Bilen hade inga sparade fel.\nLyser lampan ändå? Stäng av bilen, vänta en stund och starta igen." });
    } finally {
      await elm.disconnect();
    }
  }

  async function toggleHistory() {
    setHistory(history ? null : await load<HistItem[]>("history", []));
  }

  const working = screen.kind === "work";

  return (
    <View style={[s.root, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 6 }]}>
      <StatusBar style={dark ? "light" : "dark"} />
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {screen.kind === "idle" && !history && (
          <FadeIn style={s.screen}>
            <View>
              <Text style={s.hello}>{greeting()}!</Text>
              <Text style={s.lead}>Har motorlampan tänts? Ingen fara, det här fixar vi tillsammans på en halv minut.</Text>
            </View>

            <View style={s.stepsCard}>
              <Instruction c={c} n={1} icon="car-key" text="Vrid om nyckeln till tändning på" sub="Motorn behöver inte vara igång" />
              <View style={s.divider} />
              <Instruction c={c} n={2} icon="usb-port" text="Se till att scannern sitter i" sub="Under ratten, nere vid knäna" />
              <View style={s.divider} />
              <Instruction c={c} n={3} icon="gesture-tap" text="Tryck på den stora knappen" />
            </View>

            <BigButton c={c} onPress={() => start()} />
          </FadeIn>
        )}

        {working && (
          <FadeIn style={s.screen}>
            <View>
              <Text style={s.title}>Nu fixar vi det</Text>
              <Text style={s.lead}>Luta dig tillbaka, det tar bara en liten stund.</Text>
            </View>
            <View style={s.card}>
              {STEPS.map((st, i) => (
                <ProgressRow key={st.label} c={c} label={st.label} icon={st.icon}
                  state={i < screen.step ? "done" : i === screen.step ? "active" : "todo"} last={i === STEPS.length - 1} />
              ))}
            </View>
          </FadeIn>
        )}

        {screen.kind === "pick" && (
          <FadeIn style={s.screen}>
            <View>
              <Text style={s.title}>Vilken är scannern?</Text>
              <Text style={s.lead}>Tryck på den. Appen kommer ihåg den till nästa gång.</Text>
            </View>
            <View style={{ gap: 12 }}>
              {screen.list.map(d => (
                <Pressable key={d.id} onPress={() => pick(d)}
                  style={({ pressed }) => [s.pickBtn, pressed && s.pressed]} accessibilityRole="button">
                  <View style={s.pickIcon}><MaterialCommunityIcons name="bluetooth" size={26} color={c.primary} /></View>
                  <Text style={s.pickText} numberOfLines={1}>{d.name}</Text>
                  <MaterialCommunityIcons name="chevron-right" size={30} color={c.muted} />
                </Pressable>
              ))}
            </View>
            <SecondaryButton c={c} label="Avbryt" onPress={() => setScreen({ kind: "idle" })} />
          </FadeIn>
        )}

        {(screen.kind === "ok" || screen.kind === "calm") && (
          <FadeIn style={s.screen}>
            <ResultBadge c={c} ok={screen.kind === "ok"} icon={screen.icon} />
            <View style={{ alignItems: "center" }}>
              <Text style={[s.title, { textAlign: "center" }]}>{screen.title}</Text>
              <Text style={[s.lead, { textAlign: "center" }]}>{screen.text}</Text>
            </View>

            {!!screen.codes?.length && <CodeDetails c={c} codes={screen.codes} startOpen={screen.kind === "calm"} />}

            <View style={{ gap: 12 }}>
              {screen.retry && (
                <PrimaryButton c={c} icon="refresh"
                  label={screen.retry === "again" ? "Försök igen" : screen.retry === "search" ? "Leta igen" : "Välj scanner"}
                  onPress={() => start(screen.retry !== "again")} />
              )}
              <SecondaryButton c={c} label={screen.kind === "ok" ? "Klar" : "Tillbaka"} onPress={() => setScreen({ kind: "idle" })} />
              {screen.retry === "search" && (
                <Pressable onPress={() => start(true, true)} style={{ alignSelf: "center", padding: 8 }} accessibilityRole="button">
                  <Text style={s.footText}>Visa alla Bluetooth-enheter</Text>
                </Pressable>
              )}
            </View>
          </FadeIn>
        )}

        {history && screen.kind === "idle" && (
          <FadeIn style={s.screen}>
            <Text style={s.title}>Historik</Text>
            <View style={s.card}>
              {history.length === 0 && <Text style={s.histEmpty}>Här syns varje gång du har släckt lampan.</Text>}
              {history.map((h, i) => (
                <View key={h.t} style={[s.histRow, i > 0 && s.histBorder]}>
                  <MaterialCommunityIcons name={h.note ? "refresh" : h.left.length ? "wrench-outline" : "check-circle"} size={24}
                    color={h.note || h.left.length ? c.primary : c.ok} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.histDate}>
                      {new Date(h.t).toLocaleString("sv-SE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </Text>
                    <Text style={s.histCodes}>
                      {h.note ? "Avbröts: " + h.note
                        : (h.codes.length ? h.codes.join(", ") : "Inga felkoder") + (h.left.length ? " · tändes igen" : "")}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
            <SecondaryButton c={c} label="Tillbaka" onPress={() => setHistory(null)} />
          </FadeIn>
        )}
      </ScrollView>

      {screen.kind === "idle" && !history && (
        <View style={s.footer}>
          <FooterLink c={c} icon="swap-horizontal" label="Byt scanner" onPress={() => start(true)} />
          <FooterLink c={c} icon="history" label="Historik" onPress={toggleHistory} />
        </View>
      )}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Komponenter                                                        */
/* ------------------------------------------------------------------ */

type C = typeof lightColors;

function FadeIn({ children, style }: { children: ReactNode; style?: any }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(a, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: native }).start();
  }, []);
  return (
    <Animated.View style={[style, { opacity: a, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

function Instruction({ c, n, icon, text, sub }: { c: C; n: number; icon: IconName; text: string; sub?: string }) {
  const s = makeStyles(c);
  return (
    <View style={s.instr}>
      <View style={s.instrIcon}>
        <MaterialCommunityIcons name={icon} size={28} color={c.primary} />
        <View style={s.instrNum}><Text style={s.instrNumText}>{n}</Text></View>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.instrText}>{text}</Text>
        {!!sub && <Text style={s.instrSub}>{sub}</Text>}
      </View>
    </View>
  );
}

/** Den stora runda knappen, med en lugn pulserande ring runt. */
function BigButton({ c, onPress }: { c: C; onPress: () => void }) {
  const s = makeStyles(c);
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(pulse, {
      toValue: 1, duration: 2200, easing: Easing.out(Easing.quad), useNativeDriver: native,
    }));
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <View style={s.bigWrap}>
      <Animated.View pointerEvents="none" style={[s.ring, {
        opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }),
        transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.22] }) }],
      }]} />
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Släck motorlampan"
        style={({ pressed }) => [s.big, pressed && { transform: [{ scale: 0.96 }] }]}>
        <MaterialCommunityIcons name="engine" size={64} color={c.amber} />
        <Text style={s.bigText}>Släck{"\n"}motorlampan</Text>
      </Pressable>
    </View>
  );
}

function ProgressRow({ c, label, icon, state, last }:
  { c: C; label: string; icon: IconName; state: "done" | "active" | "todo"; last: boolean }) {
  const s = makeStyles(c);
  return (
    <View style={s.progRow}>
      <View style={{ alignItems: "center" }}>
        <View style={[s.progDot,
          state === "done" && { backgroundColor: c.ok, borderColor: c.ok },
          state === "active" && { borderColor: c.primary }]}>
          {state === "done" && <MaterialCommunityIcons name="check-bold" size={22} color="#fff" />}
          {state === "active" && <ActivityIndicator color={c.primary} />}
          {state === "todo" && <MaterialCommunityIcons name={icon} size={20} color={c.faint} />}
        </View>
        {!last && <View style={[s.progLine, state === "done" && { backgroundColor: c.ok }]} />}
      </View>
      <Text style={[s.progText, state === "todo" && { color: c.faint }, state === "active" && { fontWeight: "700" }]}>
        {label}
      </Text>
    </View>
  );
}

function ResultBadge({ c, ok, icon }: { c: C; ok: boolean; icon?: IconName }) {
  const s = makeStyles(c);
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(a, { toValue: 1, friction: 5, tension: 70, useNativeDriver: native }).start();
  }, []);
  return (
    <View style={{ alignItems: "center", paddingTop: 12 }}>
      <View style={[s.badgeHalo, { backgroundColor: ok ? c.okSoft : c.primarySoft }]}>
        <Animated.View style={[s.badge, { backgroundColor: ok ? c.ok : c.calm, transform: [{ scale: a }] }]}>
          <MaterialCommunityIcons name={ok ? "check-bold" : icon ?? "refresh"} size={ok ? 72 : 64} color="#fff" />
        </Animated.View>
      </View>
    </View>
  );
}

function CodeDetails({ c, codes, startOpen }: { c: C; codes: string[]; startOpen?: boolean }) {
  const s = makeStyles(c);
  const [open, setOpen] = useState(!!startOpen);
  return (
    <View style={s.card}>
      <Pressable onPress={() => setOpen(!open)} style={s.detailsHead} accessibilityRole="button">
        <Text style={s.detailsTitle}>Vill du veta mer?</Text>
        <MaterialCommunityIcons name={open ? "chevron-up" : "chevron-down"} size={26} color={c.muted} />
      </Pressable>
      {open && (
        <>
          {codes.map(code => {
            const info = codeInfo(code);
            return (
              <View key={code} style={s.codeBlock}>
                <View style={s.codeHead}>
                  <Text style={s.code}>{code}</Text>
                  <Text style={s.codeTitle}>{info.title}</Text>
                </View>
                <View style={s.fixRow}>
                  <MaterialCommunityIcons name="wrench-outline" size={20} color={c.primary} style={{ marginTop: 2 }} />
                  <Text style={s.fixText}>{info.fix}</Text>
                </View>
              </View>
            );
          })}
          <Text style={s.disclaimer}>
            Det här är bara vanliga orsaker. Verkstaden kan ta en närmare titt om det behövs.
          </Text>
        </>
      )}
    </View>
  );
}

function PrimaryButton({ c, label, icon, onPress }: { c: C; label: string; icon?: IconName; onPress: () => void }) {
  const s = makeStyles(c);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [s.primary, pressed && s.pressed]}>
      {icon && <MaterialCommunityIcons name={icon} size={26} color="#fff" />}
      <Text style={s.primaryText}>{label}</Text>
    </Pressable>
  );
}

function SecondaryButton({ c, label, onPress }: { c: C; label: string; onPress: () => void }) {
  const s = makeStyles(c);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [s.secondary, pressed && s.pressed]}>
      <Text style={s.secondaryText}>{label}</Text>
    </Pressable>
  );
}

function FooterLink({ c, icon, label, onPress }: { c: C; icon: IconName; label: string; onPress: () => void }) {
  const s = makeStyles(c);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.footLink, pressed && { opacity: 0.6 }]} accessibilityRole="button">
      <MaterialCommunityIcons name={icon} size={20} color={c.muted} />
      <Text style={s.footText}>{label}</Text>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/*  Färger och stil                                                    */
/* ------------------------------------------------------------------ */

const lightColors = {
  bg: "#f7f3ec", card: "#ffffff", fg: "#1f2430", muted: "#626877", faint: "#b4b8c2", line: "#ece6db",
  primary: "#2457c5", primarySoft: "#e7eefc", amber: "#ffb21e",
  ok: "#2f9e5d", okSoft: "#dff3e7", calm: "#4a7fd6",
  bigTop: "#2457c5", shadow: "#1b2a4a",
};
const darkColors = {
  bg: "#10141c", card: "#1a2030", fg: "#f1f3f8", muted: "#a3aabb", faint: "#4c5466", line: "#273042",
  primary: "#5b8cff", primarySoft: "#1f2d4d", amber: "#ffb21e",
  ok: "#3fbf74", okSoft: "#16372a", calm: "#5b8cff",
  bigTop: "#2f63d6", shadow: "#000000",
};

const makeStyles = (c: C) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  scroll: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 20, paddingVertical: 12 },
  screen: { gap: 26, width: "100%", maxWidth: 520, alignSelf: "center" },

  hello: { fontSize: 36, fontWeight: "800", color: c.fg, letterSpacing: -0.5 },
  title: { fontSize: 32, fontWeight: "800", color: c.fg, letterSpacing: -0.4 },
  lead: { fontSize: 20, lineHeight: 28, color: c.muted, marginTop: 6 },

  card: { backgroundColor: c.card, borderRadius: 24, padding: 20,
    shadowColor: c.shadow, shadowOpacity: 0.07, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  stepsCard: { backgroundColor: c.card, borderRadius: 24, paddingVertical: 8, paddingHorizontal: 18,
    shadowColor: c.shadow, shadowOpacity: 0.07, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  divider: { height: 1, backgroundColor: c.line, marginLeft: 70 },

  instr: { flexDirection: "row", alignItems: "center", gap: 16, paddingVertical: 14 },
  instrIcon: { width: 54, height: 54, borderRadius: 18, backgroundColor: c.primarySoft, alignItems: "center", justifyContent: "center" },
  instrNum: { position: "absolute", top: -6, left: -6, width: 24, height: 24, borderRadius: 12, backgroundColor: c.primary,
    alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: c.card },
  instrNumText: { color: "#fff", fontSize: 13, fontWeight: "800" },
  instrText: { fontSize: 19, lineHeight: 25, fontWeight: "600", color: c.fg },
  instrSub: { fontSize: 16, lineHeight: 22, color: c.muted, marginTop: 2 },

  bigWrap: { alignItems: "center", justifyContent: "center", paddingVertical: 10 },
  ring: { position: "absolute", width: 236, height: 236, borderRadius: 118, backgroundColor: c.primary },
  big: { width: 236, height: 236, borderRadius: 118, backgroundColor: c.bigTop, alignItems: "center", justifyContent: "center", gap: 6,
    borderWidth: 6, borderColor: "rgba(255,255,255,0.18)",
    shadowColor: c.primary, shadowOpacity: 0.45, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 8 },
  bigText: { color: "#fff", fontSize: 25, lineHeight: 30, fontWeight: "800", textAlign: "center" },

  progRow: { flexDirection: "row", gap: 16, minHeight: 64 },
  progDot: { width: 44, height: 44, borderRadius: 22, borderWidth: 3, borderColor: c.line, backgroundColor: c.card,
    alignItems: "center", justifyContent: "center" },
  progLine: { width: 3, flex: 1, minHeight: 18, backgroundColor: c.line, marginVertical: 2 },
  progText: { fontSize: 20, color: c.fg, paddingTop: 9 },

  badgeHalo: { width: 168, height: 168, borderRadius: 84, alignItems: "center", justifyContent: "center" },
  badge: { width: 124, height: 124, borderRadius: 62, alignItems: "center", justifyContent: "center" },

  detailsHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  detailsTitle: { fontSize: 18, fontWeight: "600", color: c.muted },
  codeBlock: { paddingTop: 16, marginTop: 16, borderTopWidth: 1, borderTopColor: c.line, gap: 10 },
  codeHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  code: { fontSize: 16, fontWeight: "800", color: c.fg, backgroundColor: c.primarySoft, paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 8, overflow: "hidden", fontVariant: ["tabular-nums"] },
  codeTitle: { flex: 1, fontSize: 18, fontWeight: "700", color: c.fg },
  fixRow: { flexDirection: "row", gap: 10, backgroundColor: c.bg, borderRadius: 14, padding: 12 },
  fixText: { flex: 1, fontSize: 17, lineHeight: 24, color: c.fg },
  disclaimer: { fontSize: 14, lineHeight: 20, color: c.muted, marginTop: 14 },

  primary: { minHeight: 68, borderRadius: 20, backgroundColor: c.primary, flexDirection: "row", gap: 10,
    alignItems: "center", justifyContent: "center", paddingHorizontal: 20 },
  primaryText: { color: "#fff", fontSize: 22, fontWeight: "700" },
  secondary: { minHeight: 64, borderRadius: 20, backgroundColor: c.card, borderWidth: 2, borderColor: c.line,
    alignItems: "center", justifyContent: "center" },
  secondaryText: { color: c.fg, fontSize: 21, fontWeight: "700" },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },

  pickBtn: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: c.card, borderRadius: 20, padding: 16,
    shadowColor: c.shadow, shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  pickIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: c.primarySoft, alignItems: "center", justifyContent: "center" },
  pickText: { flex: 1, fontSize: 21, fontWeight: "600", color: c.fg },

  histEmpty: { fontSize: 18, color: c.muted, textAlign: "center", paddingVertical: 8 },
  histRow: { flexDirection: "row", gap: 14, alignItems: "center", paddingVertical: 12 },
  histBorder: { borderTopWidth: 1, borderTopColor: c.line },
  histDate: { fontSize: 17, fontWeight: "600", color: c.fg },
  histCodes: { fontSize: 15, color: c.muted, marginTop: 2 },

  footer: { flexDirection: "row", justifyContent: "center", gap: 28, paddingVertical: 8 },
  footLink: { flexDirection: "row", alignItems: "center", gap: 6, padding: 8 },
  footText: { fontSize: 16, color: c.muted, fontWeight: "500" },
});
