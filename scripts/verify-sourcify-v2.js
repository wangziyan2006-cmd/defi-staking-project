/**
 * Verify deployed contracts on Sourcify using the v2 API.
 * hardhat-verify's Sourcify plugin still calls the retired v1 endpoints,
 * so this script posts the solc standard-JSON input directly.
 *
 * Usage: node scripts/verify-sourcify-v2.js <address> <ContractName>
 *   e.g. node scripts/verify-sourcify-v2.js 0x9883...c344 DeFiStaking
 */
const fs = require("fs");
const path = require("path");

const CHAIN_ID = 11155111;
const COMPILER = (process.argv[4] || "0.8.20+commit.a1b79de6").trim();
const API = "https://sourcify.dev/server";

const address = (process.argv[2] || "").trim();
const contractName = (process.argv[3] || "").trim();
if (!address || !contractName) {
  console.error("usage: node scripts/verify-sourcify-v2.js <address> <ContractName>");
  process.exit(1);
}

const stdJsonInput = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "flattened", "standard-json-input.json"), "utf8")
);
const sourcePath = Object.keys(stdJsonInput.sources).find((p) =>
  p.endsWith(`/${contractName}.sol`)
);
if (!sourcePath) {
  console.error(`source for ${contractName} not found in standard-json-input.json`);
  process.exit(1);
}

(async () => {
  const body = {
    stdJsonInput,
    compilerVersion: COMPILER,
    contractIdentifier: `${sourcePath}:${contractName}`,
    creationBytecode: undefined,
  };
  const url = `${API}/v2/verify/${CHAIN_ID}/${address}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "cds528-defi-staking/1.0" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log("POST", url, "->", res.status);
  console.log(text);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    return;
  }
  const id = parsed.verificationId || parsed.id;
  if (!id) return;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const st = await fetch(`${API}/v2/verify/${id}`, {
      headers: { "User-Agent": "cds528-defi-staking/1.0" },
    });
    const s = await st.text();
    let p = {};
    try {
      p = JSON.parse(s);
    } catch (_) {}
    console.log(
      "poll",
      i + 1,
      st.status,
      JSON.stringify({
        done: p.isJobCompleted,
        match: p.contract && p.contract.match,
        runtimeMatch: p.contract && p.contract.runtimeMatch,
        creationMatch: p.contract && p.contract.creationMatch,
        error: p.error && (p.error.message || p.error.customCode),
      })
    );
    if (p.isJobCompleted || p.status === "verified" || p.status === "failed") break;
  }
})();
