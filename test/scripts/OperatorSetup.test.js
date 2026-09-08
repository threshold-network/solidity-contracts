const { expect } = require("chai")
const fs = require("fs")
const os = require("os")
const path = require("path")
const crypto = require("crypto")
const { spawnSync } = require("child_process")

const root = path.resolve(__dirname, "../..")
const hash = (file) =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")

describe("Operator setup tools", function () {
  // Real wallet encryption can exceed Mocha's default two-second timeout.
  // eslint-disable-next-line no-invalid-this
  this.timeout(60000)
  let dir

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "operator-setup-"))
    fs.mkdirSync(path.join(dir, "scripts/lib"), { recursive: true })
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  function env(extra = {}) {
    return Object.assign(
      {
        PATH: process.env.PATH,
        NODE_PATH: path.join(root, "node_modules"),
        CHAIN_API_URL: "http://127.0.0.1:1",
      },
      extra
    )
  }

  for (const index of [undefined, "1"]) {
    it(`preserves existing ${
      index ? "indexed" : "default"
    } keys and creates files privately`, () => {
      const script = path.join(dir, "scripts/setup-new-staking-provider.js")
      fs.copyFileSync(
        path.join(root, "scripts/setup-new-staking-provider.js"),
        script
      )
      const args = [script, "local-test-password"]
      if (index) args.push(index)
      const first = spawnSync(process.execPath, args, {
        env: env(),
        encoding: "utf8",
      })
      expect(first.status, first.stderr).to.equal(0)
      const file = path.join(
        dir,
        index ? ".env.operator-1" : ".env.new-operator"
      )
      const before = hash(file)
      const keystores = fs.readdirSync(path.join(dir, "operator-1-keystore"))
      expect(fs.statSync(file).mode & 0o777).to.equal(0o600)
      expect(
        fs.statSync(path.join(dir, "operator-1-keystore", keystores[0])).mode &
          0o777
      ).to.equal(0o600)
      const second = spawnSync(process.execPath, args, {
        env: env(),
        encoding: "utf8",
      })
      expect(second.status).not.to.equal(0)
      expect(second.stderr).to.include("Refusing to overwrite")
      expect(hash(file)).to.equal(before)
      expect(
        fs.readdirSync(path.join(dir, "operator-1-keystore"))
      ).to.deep.equal(keystores)
    })
  }

  it("refuses a symlink at the credential path without changing its target", () => {
    const script = path.join(dir, "scripts/setup-new-staking-provider.js")
    fs.copyFileSync(
      path.join(root, "scripts/setup-new-staking-provider.js"),
      script
    )
    const target = path.join(dir, "existing-wallet")
    fs.writeFileSync(target, "preserved test data")
    fs.symlinkSync(target, path.join(dir, ".env.operator-1"))
    const result = spawnSync(
      process.execPath,
      [script, "local-test-password", "1"],
      { env: env(), encoding: "utf8" }
    )
    expect(result.status).not.to.equal(0)
    expect(fs.readFileSync(target, "utf8")).to.equal("preserved test data")
  })

  it("allows a fresh attempt after credential directory setup fails", () => {
    const script = path.join(dir, "scripts/setup-new-staking-provider.js")
    fs.copyFileSync(
      path.join(root, "scripts/setup-new-staking-provider.js"),
      script
    )
    const keystoreDir = path.join(dir, "operator-1-keystore")
    fs.writeFileSync(keystoreDir, "temporary directory conflict")
    const args = [script, "local-test-password", "1"]
    const first = spawnSync(process.execPath, args, {
      env: env(),
      encoding: "utf8",
    })
    expect(first.status).not.to.equal(0)
    expect(fs.existsSync(path.join(dir, ".env.operator-1"))).to.equal(false)
    fs.unlinkSync(keystoreDir)
    const second = spawnSync(process.execPath, args, {
      env: env(),
      encoding: "utf8",
    })
    expect(second.status, second.stderr).to.equal(0)
    expect(
      fs.statSync(path.join(dir, ".env.operator-1")).size
    ).to.be.greaterThan(0)
  })

  function runCast(mode) {
    const bin = path.join(dir, "bin")
    fs.mkdirSync(bin)
    const log = path.join(dir, "calls")
    fs.writeFileSync(
      path.join(bin, "cast"),
      `#!/bin/bash
[ -z "\${ETH_PRIVATE_KEY:-}" ] || exit 90
echo "$1" >> "$CALL_LOG"
if [ "$1" = "send" ]; then
  case "$CAST_MODE" in
    known) echo "already known" >&2; exit 1 ;;
    nonce) echo "nonce too low" >&2; exit 1 ;;
    used) echo "nonce has already been used" >&2; exit 1 ;;
    missing) echo "receipt unavailable"; exit 0 ;;
  esac
  echo "transactionHash 0x1111111111111111111111111111111111111111111111111111111111111111"
else
  if [ "$CAST_MODE" = "receipt-failure" ]; then exit 1; fi
  if [ "$CAST_MODE" = "revert" ]; then echo "status 0"; else echo "status 1"; fi
fi
`,
      { mode: 0o755 }
    )
    const result = spawnSync(
      "bash",
      [
        "-c",
        `
source "$1"
_cast_keystore_for_key() {
  _CAST_LAST_KEYSTORE=/dev/null
  _CAST_LAST_PASSFILE=/dev/null
}
ETH_PRIVATE_KEY=local-test-key cast_send_ok 0x123 --rpc-url "$CHAIN_API_URL"
`,
        "test",
        path.join(root, "scripts/lib/cast-helpers.sh"),
      ],
      {
        env: env({
          PATH: bin + path.delimiter + process.env.PATH,
          CALL_LOG: log,
          CAST_MODE: mode,
        }),
        encoding: "utf8",
      }
    )
    return { result, calls: fs.readFileSync(log, "utf8").trim().split("\n") }
  }

  for (const mode of [
    "known",
    "nonce",
    "used",
    "missing",
    "receipt-failure",
    "revert",
  ]) {
    it(`stops without rebuilding a transaction on ${mode}`, () => {
      const { result, calls } = runCast(mode)
      expect(result.status).not.to.equal(0)
      expect(calls.filter((call) => call === "send")).to.have.lengthOf(1)
    })
  }

  it("accepts a confirmed successful receipt", () => {
    const { result, calls } = runCast("success")
    expect(result.status, result.stderr).to.equal(0)
    expect(calls).to.deep.equal(["send", "receipt"])
  })

  function existingOperator(failingStep, missing = false) {
    const deployments = path.join(dir, "tbtc-v2/solidity/deployments/sepolia")
    fs.mkdirSync(deployments, { recursive: true })
    for (const name of [
      "TokenStaking",
      "RandomBeacon",
      "WalletRegistry",
      "T",
    ]) {
      fs.writeFileSync(
        path.join(deployments, name + ".json"),
        JSON.stringify({ address: "0x123" })
      )
    }
    fs.copyFileSync(
      path.join(root, "scripts/setup-multiple-operators.sh"),
      path.join(dir, "scripts/setup-multiple-operators.sh")
    )
    const log = path.join(dir, "calls")
    fs.writeFileSync(log, "")
    fs.writeFileSync(
      path.join(dir, "scripts/lib/cast-helpers.sh"),
      `
calls=0
cast() { echo 1; }
cast_send_ok() {
  calls=$((calls + 1))
  echo "$calls" >> "$CALL_LOG"
  [ "$calls" != "$FAIL_STEP" ]
}
`
    )
    const config = path.join(dir, ".env.operators-3")
    fs.writeFileSync(
      config,
      missing
        ? ""
        : `
OP1_STAKING_PROVIDER_ADDRESS=0x123
OP1_STAKING_PROVIDER_KEY=local-test-key
OP1_OPERATOR_ADDRESS=0x456
OP1_OPERATOR_KEY=local-test-key
`
    )
    const result = spawnSync(
      "bash",
      [
        path.join(dir, "scripts/setup-multiple-operators.sh"),
        "1",
        "local-test-password",
        "--existing",
      ],
      {
        cwd: dir,
        env: env({
          THRESHOLD_WORKSPACE_ROOT: dir,
          SOLIDITY_CONTRACTS_DIR: dir,
          OPERATORS_CONFIG: config,
          CALL_LOG: log,
          FAIL_STEP: String(failingStep),
        }),
        encoding: "utf8",
      }
    )
    return {
      result,
      calls: fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean),
    }
  }

  for (let step = 1; step <= 6; step++) {
    it(`propagates failure at existing-operator transaction ${step}`, () => {
      const { result, calls } = existingOperator(step)
      expect(result.status).not.to.equal(0)
      expect(calls).to.have.lengthOf(step)
      expect(result.stdout).not.to.include("Registered:")
      expect(result.stdout).not.to.include("existing operators registered")
    })
  }

  it("fails overall when operator configuration is incomplete", () => {
    const { result, calls } = existingOperator(0, true)
    expect(result.status).not.to.equal(0)
    expect(calls).to.have.lengthOf(0)
  })

  it("reports success only after all six transactions complete", () => {
    const { result, calls } = existingOperator(0)
    expect(result.status, result.stderr).to.equal(0)
    expect(calls).to.have.lengthOf(6)
    expect(result.stdout).to.include("1 existing operators registered")
  })

  function fundOperator(selection) {
    const repo = path.join(dir, "solidity-contracts")
    fs.mkdirSync(path.join(repo, "scripts/lib"), { recursive: true })
    fs.copyFileSync(
      path.join(root, "scripts/fund-new-operator.sh"),
      path.join(repo, "scripts/fund-new-operator.sh")
    )
    const deployments = path.join(dir, "tbtc-v2/solidity/deployments/sepolia")
    fs.mkdirSync(deployments, { recursive: true })
    fs.writeFileSync(
      path.join(deployments, "T.json"),
      JSON.stringify({ address: "0x123" })
    )
    const log = path.join(dir, "funding-calls")
    fs.writeFileSync(log, "")
    fs.writeFileSync(
      path.join(repo, "scripts/lib/cast-helpers.sh"),
      'cast_send_ok() { echo "$3" >> "$CALL_LOG"; }\n'
    )
    const bin = path.join(dir, "bin")
    fs.mkdirSync(bin)
    fs.writeFileSync(path.join(bin, "cast"), "#!/bin/bash\necho 80000\n", {
      mode: 0o755,
    })
    const config = (provider) =>
      `NEW_STAKING_PROVIDER_ADDRESS=${provider}\nNEW_OPERATOR_ADDRESS=0x456\n`
    fs.writeFileSync(path.join(repo, ".env"), "# Shared funding settings\n")
    fs.writeFileSync(path.join(repo, ".env.new-operator"), config("0x111"))
    fs.writeFileSync(path.join(repo, "selected operator.env"), config("0x222"))
    for (const name of [".env", ".env.new-operator", "selected operator.env"]) {
      fs.writeFileSync(path.join(bin, name), config("0x999"))
    }
    let args = []
    if (selection === "missing") args = ["missing.env"]
    if (selection === "empty") args = [""]
    if (selection === "directory") args = ["scripts"]
    if (selection === "relative") args = ["selected operator.env"]
    if (selection === "absolute") {
      args = [path.join(repo, "selected operator.env")]
    }
    if (selection === "environment") {
      fs.unlinkSync(path.join(repo, ".env.new-operator"))
    }
    const result = spawnSync(
      "bash",
      [path.join(repo, "scripts/fund-new-operator.sh"), ...args],
      {
        cwd: dir,
        env: env({
          PATH: bin + path.delimiter + process.env.PATH,
          CALL_LOG: log,
          CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY: "local-test-key",
          NEW_STAKING_PROVIDER_ADDRESS: "0x333",
          NEW_OPERATOR_ADDRESS: "0x456",
        }),
        encoding: "utf8",
      }
    )
    return { result, transfers: fs.readFileSync(log, "utf8").trim() }
  }

  for (const selection of ["missing", "empty", "directory"]) {
    it(`rejects a ${selection} explicit funding file without using the default wallet`, () => {
      const { result, transfers } = fundOperator(selection)
      expect(result.status).not.to.equal(0)
      expect(result.stderr).to.include("Operator configuration")
      expect(transfers).to.equal("")
    })
  }

  for (const [selection, provider] of [
    ["relative", "0x222"],
    ["absolute", "0x222"],
    ["default", "0x111"],
    ["environment", "0x333"],
  ]) {
    it(`funds the selected provider using ${selection} configuration despite PATH shadowing`, () => {
      const { result, transfers } = fundOperator(selection)
      expect(result.status, result.stderr).to.equal(0)
      expect(transfers).to.equal(provider)
    })
  }
})
