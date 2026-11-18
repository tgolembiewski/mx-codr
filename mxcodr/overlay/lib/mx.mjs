// The mxcli release this bundle is pinned to, and the bundle's own version (YYYY.MM.DD.N).
export const PIN = '0.31.0';
export const BUNDLE = '2026.11.11.2';
// sha256 of each release asset of PIN (GitHub's asset digests, mendixlabs/mxcli v0.31.0). The Studio Pro extension's
// setup downloads mxcli itself and checks it against this table; the file-mode installer does not read it yet.
export const PIN_SHA256 = {
  'mxcli-darwin-amd64': 'c37f8595f14a7195cdb4013f616c692352f3b73530d527bf16bca9664b7f083b',
  'mxcli-darwin-arm64': '5fbca736bb43d82964f4fb81774cb65b2c6da34ba61304975e5095b93b3ae9b3',
  'mxcli-linux-amd64': '602f886066ac860710c8ef926756ac52d0bf5d74c8b6dcde101251aff228699c',
  'mxcli-linux-arm64': 'b2e1e74cb4522579af61fdd1e1a35ce28762600520d761733031f1899a602a14',
  'mxcli-windows-amd64.exe': '0a63a7884e91947765370a4111420676ac0121565d233c7cacd480f2f79ed6d1',
  'mxcli-windows-arm64.exe': 'd2173aed7003487583e2525f108d681617f47f4089bc7c4a7d986b8229f425b2',
};
