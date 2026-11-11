# Motorlampan

En knapp: ansluter iPhone till en Bluetooth LE ELM327 OBD2-scanner, läser felkoderna och raderar dem.

- Öppnas i **Bluefy** (App Store) – Safari stödjer inte Web Bluetooth.
- `?demo` kör mot en låtsasscanner, `?demo=0` = inga koder, `?demo=fail` = bilen svarar inte.

## iPhone-appen (`app/`)

Expo/React Native-app med samma funktion, installeras ad hoc (inte via App Store).

```bash
cd app
npx eas-cli@latest login            # Expo-konto (gratis)
npx eas-cli@latest device:create    # registrera mammas iPhone (öppna länken på hennes telefon i Safari)
npx eas-cli@latest build -p ios --profile preview   # bygger i molnet, ger en installationslänk
```

På hennes iPhone: Inställningar → Integritet och säkerhet → Utvecklarläge → På (krävs för ad hoc-appar).
Logiktester: `node src/obd.test.ts`.

### Förhandsvisa designen på datorn

`cd app` och `npx.cmd expo start --web`, öppna sedan http://localhost:8081. En låtsasscanner (`src/ble.web.ts`) används i webbläsaren.
Lägg till `?demo=0`, `?demo=fail`, `?demo=pick`, `?demo=none` eller `?demo=back` för att se de olika lägena.
