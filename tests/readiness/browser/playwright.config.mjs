// Playwright configuration for the real-stack acceptance run.
// Everything is driven by environment variables set by scripts/readiness/verify-clean-stack.sh:
//   MTK_BASE_URL  origin of THIS run's isolated stack (required; no default, so a stale stack on
//                 a well-known port can never be hit by accident)
//   MTK_OUTPUT    evidence directory (required)
//   MTK_REPO      the ephemeral clean checkout that was built (required)
import path from "node:path";

for (const v of ["MTK_BASE_URL", "MTK_OUTPUT", "MTK_REPO"]) {
  if (!process.env[v]) throw new Error(`${v} is required (run via scripts/readiness/verify-clean-stack.sh)`);
}
const out = process.env.MTK_OUTPUT;

export default {
  testDir: ".",
  testMatch: /acceptance\.spec\.mjs$/,
  workers: 1,
  fullyParallel: false,
  retries: 0,                       // a flaky pass is not a pass
  timeout: 6 * 60 * 1000,
  expect: { timeout: 20_000 },
  forbidOnly: true,
  reporter: [["list"], ["json", { outputFile: path.join(out, "playwright-report.json") }]],
  outputDir: path.join(out, "playwright-artifacts"),
  use: {
    baseURL: process.env.MTK_BASE_URL,
    acceptDownloads: true,
    screenshot: "on",
    trace: "off",                   // the spec records one trace for the whole serial flow itself
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
};
