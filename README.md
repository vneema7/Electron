# Electron AirDrop

A desktop app for sharing individual files between Windows, macOS and Linux computers on the same local network. This implements the existing **share → discover → download** workflow: drop a file to make it available, then the receiving person chooses whether to save it. It does not interoperate with Apple's AirDrop.

## Download and open on Windows

1. Install **Node.js 22 or newer** from [nodejs.org](https://nodejs.org/). This is needed once on each computer.
2. [Download the latest source ZIP](https://github.com/vneema7/Electron/archive/refs/heads/main.zip).
3. Right-click the ZIP → **Extract All**. Move the extracted folder to **Documents** and rename it **AirDrop File Sharing** if you like. Do not run the app from inside the ZIP.
4. Open the extracted folder containing **package.json** and **Open AirDrop.cmd**. If there is another folder inside, open that first.
5. Click File Explorer's address bar, type `cmd`, and press Enter.
6. In that command window, run `npm ci` and wait for installation to finish. This is needed once per fresh download.
7. Double-click **Open AirDrop.cmd** (or run `npm start`). Keep its command window open while using the app.

**To open it again:** go to Documents → AirDrop File Sharing and double-click **Open AirDrop.cmd**. You do not need to reinstall dependencies.

If `npm` is not recognized, install Node.js and reopen the command window. If `npm ci` says the lockfile is missing, you are in the wrong folder: open the folder containing both `package.json` and `package-lock.json`.

Everyone must run this updated version and be on the **same Wi-Fi or local network**. Sending the ZIP over the internet is fine; the app itself does not transfer files between remote internet locations. Older release installers do not contain these fixes; use the source ZIP linked above.

## Run from source (macOS, Linux or terminal)

Install Node.js 22 or newer, then run the following in this repository on **both computers**:

```sh
npm ci
npm start
```

`npm run dev` opens developer tools. The launcher works on Windows, macOS and Linux and clears `ELECTRON_RUN_AS_NODE` for Electron. Existing release downloads do not include these source changes until a new release is built.

## Test between two computers

1. Connect both computers to the same trusted Wi-Fi or Ethernet network and start the app on each. Allow Electron through your firewall on the private/local network when prompted.
2. Both names should appear under **Nearby Devices** within about 3–6 seconds. No IP entry should be needed.
3. On computer A, drop a file into the window or click **Choose files**. Keep A's app open. The app makes a temporary copy, so your original stays untouched.
4. On computer B, the file appears under **Available Files** within about four seconds. Click its download arrow, or **Save to Downloads** on the incoming prompt. Files already present when B starts remain available through the list.
5. Watch the transfer byte count. On success, the file is saved in B's system Downloads folder and revealed in the file manager. Compare its contents with the original; try a photo or a larger file too.
6. Repeat in the other direction. Download the same file twice to verify that a numbered filename is used instead of overwriting it.
7. Stop sharing with the × button on A: the file should disappear on B on the next refresh. Close A: its device should disappear within about 12–15 seconds.

Declining an incoming prompt dismisses that notification; it does not remove the file from the available list. Nothing is downloaded automatically.

### If discovery does not work

- Copy A's complete **IPv4:port** address from its upper-right badge into B's **Connect Manually** field. If A has several network adapters, use the dropdown to select its Wi-Fi/Ethernet address. Manual connection is directional; connect the other way too if you want to browse B from A while multicast is blocked.
- Discovery uses IPv4 multicast **239.255.45.67, UDP 45678** with a TTL of 1. Transfers use HTTP on the dynamically assigned TCP port displayed in the app. Allow the app through the firewall rather than opening a fixed transfer port.
- Guest Wi-Fi, campus/enterprise client isolation, VPNs, and routers that block multicast can prevent discovery. Manual connection helps only when direct TCP access between devices is allowed. Client isolation can block both; use a network that permits device-to-device traffic.
- Ports change on restart, so copy the new address for manual connections. Older builds use a different discovery format; run this version on both computers.
- A visible discovery warning means manual connection may still work. Discovery rejoins interfaces as their IPv4 addresses change.

## Sharing and privacy

Use this on a trusted LAN. Device names and shared-file metadata are advertised without authentication, and transfers are plain HTTP, **not encrypted**. Any reachable LAN client can list and download files explicitly shared in the app. There is no pairing, recipient-only sharing, or sender approval per download. The incoming prompt is a receiver convenience, not access control.

Only explicitly shared copies are exposed. The network server has no upload endpoint. Network-supplied names are escaped in the UI, filenames are sanitized for Downloads, and requests have error/timeout handling. Failed or incomplete transfers remove their partial output. These checks do not provide cryptographic integrity or peer authentication.

## Storage and lifecycle

Each running instance owns a separate `electron-airdrop-*` directory under the operating system's temporary directory (`os.tmpdir()`). Shared copies expire after one hour (checked every 30 seconds), can be removed manually, and are removed on normal app shutdown. Downloads remain in Downloads. A forced kill or power loss can leave temporary copies for operating-system cleanup; the next session does not advertise them.

## Development and validation

```sh
npm test
npm run test:app
npm run build
```

- `npm test` starts two real networking instances and checks multicast discovery, bidirectional byte-for-byte transfers, empty files, filename collisions, expiry/removal, manual identity checks, malformed packets, HTTP errors, and interrupted-transfer cleanup. It requires multicast permission and an active IPv4 interface; a network sandbox may block the discovery test.
- `npm run test:app` launches the real Electron window, verifies the sandboxed preload bridge, shares a temporary file through IPC, checks its rendered name, removes it, and exits. It requires a graphical desktop.
- `npm run build` retains the existing electron-builder macOS DMG configuration. Build/package validation on macOS and Linux is still needed.

Source layout:

- `src/main.js`: Electron lifecycle, native file picker and narrowly scoped IPC.
- `src/network.js`: multicast discovery, HTTP file server/client, temporary storage and transfer handling; independent of Electron for integration tests.
- `src/preload.js`: isolated renderer bridge.
- `src/index.html`, `src/renderer.js`: existing desktop interface, nearby devices, sharing, download prompts and progress.
- `scripts/start.js`: cross-platform launcher.

## Remaining work

Pairing and encrypted, recipient-specific transfers; folder sharing; transfer cancellation; signed installers and cross-platform packaging validation.

## License

MIT
