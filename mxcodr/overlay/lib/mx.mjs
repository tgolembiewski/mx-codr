// The mxcli release this bundle is pinned to, and the bundle's own version (YYYY.MM.DD.N).
export const PIN = '0.32.0';
export const BUNDLE = '2026.11.17.15';
// sha256 of each release asset of PIN (GitHub's asset digests, mendixlabs/mxcli v0.32.0). The Studio Pro extension's
// setup downloads mxcli itself and checks it against this table; the file-mode installer does not read it yet.
export const PIN_SHA256 = {
  'mxcli-darwin-amd64': '3265bca07704d381d22fb028e985b7aca132517234bb55800cf976ec6f65996c',
  'mxcli-darwin-arm64': 'ae0d10e239468e95a7e779060a428b729cfe822eed5dbac6f0865a176b3b0e4f',
  'mxcli-linux-amd64': '2454810e06b2b25a8a9eaab4e5f9be37ce2570d844dfde5550a3101f32dce327',
  'mxcli-linux-arm64': 'eb0687c0bbf3bba6eab3aea82b22c8535a5daaaa4d68f0fe446a1460441cf944',
  'mxcli-windows-amd64.exe': 'bca6ab40f910ecf423f703099ad18e3b8da2ac3542212831ab31e4d21e2f48d6',
  'mxcli-windows-arm64.exe': 'be2e5aebfc1437a6e0e878fafbade75dcc552211abdafd31377cda2baa7a8fbd',
};
