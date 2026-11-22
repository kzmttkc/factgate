// The "Try these" buttons. The two stays are the fictional demo sites in ~/factgate-peers,
// served on this machine (README "Run the demo"); deploy/build-public.mjs rewrites them for the deployed build.
export const TRY_THESE = Object.freeze([
  Object.freeze({ label: "agent402.tools", note: "real x402 seller", url: "https://agent402.tools/api/weather-forecast" }),
  Object.freeze({ label: "Verified Stay", note: "demo site, fictional", url: "http://127.0.0.1:8792/verified_stay" }),
  Object.freeze({ label: "Glossy Stay", note: "demo site, fictional", url: "http://127.0.0.1:8791/glossy_stay" }),
]);
