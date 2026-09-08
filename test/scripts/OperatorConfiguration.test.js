const { expect } = require("chai")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { spawnSync } = require("child_process")
const { BigNumber } = require("ethers")

const root = path.resolve(__dirname, "../..")
const rpc = "http://127.0.0.1:1/intended"
const newConfig = (i) => `
NEW_STAKING_PROVIDER_ADDRESS=0x10${i}
NEW_STAKING_PROVIDER_KEY=provider-${i}
NEW_OPERATOR_ADDRESS=0x20${i}
NEW_OPERATOR_KEY=operator-${i}
`
const existingConfig = [1, 2, 3]
  .map((i) => newConfig(i).replace(/NEW_/g, `OP${i}_`))
  .join("")

describe("Operator configuration and funding", function () {
  // The complete shell flows run with local transaction and generation stubs.
  // eslint-disable-next-line no-invalid-this
  this.timeout(60000)
  let directory
  let repo
  let bin

  function shadow(name, content) {
    fs.writeFileSync(
      path.join(bin, name),
      `printf '%s\\n' '${name}' >> "$SHADOW_LOG"\n` +
        content
          .replace(/0x10/g, "0x90")
          .replace(/0x20/g, "0xa0")
          .replace(/=provider-/g, "=shadow-provider-")
          .replace(/=operator-/g, "=shadow-operator-")
    )
  }

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "operator-config-"))
    repo = path.join(directory, "solidity-contracts")
    bin = path.join(directory, "bin")
    fs.mkdirSync(path.join(repo, "scripts/lib"), { recursive: true })
    fs.mkdirSync(bin)
    for (const script of [
      "setup-multiple-operators.sh",
      "run-new-operator-setup.sh",
    ]) {
      fs.copyFileSync(
        path.join(root, "scripts", script),
        path.join(repo, "scripts", script)
      )
    }
    const deployments = path.join(
      directory,
      "tbtc-v2/solidity/deployments/sepolia"
    )
    fs.mkdirSync(deployments, { recursive: true })
    for (const name of [
      "TokenStaking",
      "RandomBeacon",
      "WalletRegistry",
      "T",
    ]) {
      fs.writeFileSync(
        path.join(deployments, `${name}.json`),
        JSON.stringify({ address: name })
      )
    }
    fs.writeFileSync(path.join(repo, "scripts/lib/cast-helpers.sh"), helpers)
    for (const name of ["calls", "shadows", "generated"]) {
      fs.writeFileSync(path.join(directory, name), "")
    }
    const shared = `CHAIN_API_URL=${rpc}\nCONTRACT_OWNER_ACCOUNT_PRIVATE_KEY=file-deployer\n`
    fs.writeFileSync(path.join(repo, ".env"), shared)
    fs.writeFileSync(path.join(repo, ".env.operators-3"), existingConfig)
    fs.writeFileSync(path.join(repo, ".env.new-operator"), newConfig(1))
    shadow(".env", "CHAIN_API_URL=http://127.0.0.1:1/shadow\n")
    shadow(".env.operators-3", existingConfig)
    shadow(".env.new-operator", newConfig(1))
    for (const i of [1, 2]) {
      fs.writeFileSync(path.join(directory, `generated-${i}.env`), newConfig(i))
      shadow(`.env.operator-${i}`, newConfig(i))
    }
  })

  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }))

  function run(script, args = [], extra = {}, cwd = repo) {
    const result = spawnSync(
      "bash",
      [path.join(repo, "scripts", script), ...args],
      {
        cwd,
        env: Object.assign(
          {
            PATH: bin + path.delimiter + process.env.PATH,
            THRESHOLD_WORKSPACE_ROOT: directory,
            SOLIDITY_CONTRACTS_DIR: repo,
            FIXTURE_DIR: directory,
            CALL_LOG: path.join(directory, "calls"),
            SHADOW_LOG: path.join(directory, "shadows"),
            GENERATION_LOG: path.join(directory, "generated"),
            CONTRACT_OWNER_ACCOUNT_PRIVATE_KEY: "local-deployer",
            CHAIN_API_URL: rpc,
            ETH_BALANCE_WEI: "10000000000000000000",
          },
          extra
        ),
        encoding: "utf8",
      }
    )
    const lines = (name) =>
      fs
        .readFileSync(path.join(directory, name), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
    return {
      result,
      calls: lines("calls").map((line) => JSON.parse(line)),
      shadows: lines("shadows"),
      generated: lines("generated"),
    }
  }

  function expectIntendedCalls(calls) {
    for (const call of calls) {
      expect(call.args[call.args.indexOf("--rpc-url") + 1]).to.equal(rpc)
      expect(call.key).not.to.include("shadow")
      expect(call.args).not.to.include("0x901")
      expect(call.args).not.to.include("0xa01")
    }
  }

  for (const selection of [
    "default",
    "relative",
    "absolute",
    "dot",
    "parent",
    "dash",
  ]) {
    it(`uses the checked ${selection} existing-operator file despite PATH shadows`, () => {
      const name =
        selection === "dash" ? "-operators.env" : "selected operators.env"
      const file = path.join(selection === "parent" ? directory : repo, name)
      fs.writeFileSync(file, existingConfig)
      shadow(name, existingConfig)
      const configs = {
        relative: name,
        absolute: file,
        dot: `./${name}`,
        parent: `../${name}`,
        dash: name,
      }
      const extra =
        selection === "default" ? {} : { OPERATORS_CONFIG: configs[selection] }
      const { result, calls, shadows } = run(
        "setup-multiple-operators.sh",
        ["1", "password", "--existing"],
        extra
      )
      expect(result.status, result.stderr).to.equal(0)
      expect(shadows).to.deep.equal([])
      expect(calls).to.have.lengthOf(6)
      expect(calls[0].key).to.equal("provider-1")
      expect(calls[0].args[2]).to.equal("0x101")
      expect(calls[2].args[2]).to.equal("0x201")
      expectIntendedCalls(calls)
    })
  }

  it("retains automatic existing mode and an empty default selection", () => {
    const { result, calls, shadows, generated } = run(
      "setup-multiple-operators.sh",
      ["3", "password"],
      { OPERATORS_CONFIG: "" }
    )
    expect(result.status, result.stderr).to.equal(0)
    expect(result.stdout).to.include("3 existing operators registered")
    expect(calls).to.have.lengthOf(18)
    expect(shadows).to.deep.equal([])
    expect(generated).to.deep.equal([])
    expectIntendedCalls(calls)
  })

  it("rejects a missing local existing configuration even when PATH contains it", () => {
    fs.unlinkSync(path.join(repo, ".env.operators-3"))
    const { result, calls } = run("setup-multiple-operators.sh", [
      "1",
      "password",
      "--existing",
    ])
    expect(result.status).not.to.equal(0)
    expect(result.stdout).to.include("Missing")
    expect(calls).to.deep.equal([])
  })

  it("loads local shared and generated configuration for new operators", () => {
    const { result, calls, shadows } = run("setup-multiple-operators.sh", [
      "1",
      "password",
      "--new",
    ])
    expect(result.status, result.stderr).to.equal(0)
    expect(shadows).to.deep.equal([])
    expect(calls).to.have.lengthOf(11)
    expect(calls[0].args[2]).to.equal("0x101")
    expect(calls[1].args[0]).to.equal("0x101")
    expect(calls[2].args[0]).to.equal("0x201")
    expectIntendedCalls(calls)
  })

  for (const [amount, wei, count, hex] of [
    [undefined, "50000000000000000", 1, false],
    ["0.05", "50000000000000000", 1, false],
    ["1", "1000000000000000000", 2, false],
    ["0.05ether", "50000000000000000", 1, true],
  ]) {
    it(`sends the checked wei to both wallets for ${amount || "default"}${
      hex ? " with hex conversion" : ""
    }`, () => {
      // Isolate amount handling from the separate configuration-shadow tests.
      for (const name of fs.readdirSync(bin))
        fs.unlinkSync(path.join(bin, name))
      const extra = {
        ETH_BALANCE_WEI: BigNumber.from(wei).mul(count).mul(2).toString(),
        HEX_CONVERSION: hex ? "1" : "0",
      }
      if (amount !== undefined) extra.ETH_PER_OPERATOR = amount
      const { result, calls, shadows, generated } = run(
        "setup-multiple-operators.sh",
        [String(count), "password", "--new"],
        extra
      )
      expect(result.status, result.stderr).to.equal(0)
      expect(shadows).to.deep.equal([])
      expect(generated).to.have.lengthOf(count)
      expect(calls).to.have.lengthOf(count * 11)
      const transfers = calls.filter((call) => call.args.includes("--value"))
      expect(transfers).to.have.lengthOf(count * 2)
      for (let i = 1; i <= count; i++) {
        expect(
          transfers
            .slice((i - 1) * 2, i * 2)
            .map((call) => [call.args[0], call.args[2], call.key])
        ).to.deep.equal([
          [`0x10${i}`, wei, "local-deployer"],
          [`0x20${i}`, wei, "local-deployer"],
        ])
      }
      expect(
        transfers
          .reduce((total, call) => total.add(call.args[2]), BigNumber.from(0))
          .toString()
      ).to.equal(extra.ETH_BALANCE_WEI)
      expectIntendedCalls(calls)
    })
  }

  it("stops before generating wallets or transferring T when ETH is one wei short", () => {
    const { result, calls, generated } = run(
      "setup-multiple-operators.sh",
      ["2", "password", "--new"],
      { ETH_PER_OPERATOR: "1", ETH_BALANCE_WEI: "3999999999999999999" }
    )
    expect(result.status).not.to.equal(0)
    expect(result.stderr).to.include("insufficient native ETH")
    expect(calls).to.deep.equal([])
    expect(generated).to.deep.equal([])
  })

  it("rejects an invalid ETH amount before generation or transfers", () => {
    const { result, calls, generated } = run(
      "setup-multiple-operators.sh",
      ["1", "password", "--new"],
      { ETH_PER_OPERATOR: "invalid" }
    )
    expect(result.status).not.to.equal(0)
    expect(calls).to.deep.equal([])
    expect(generated).to.deep.equal([])
  })

  it("does not load a PATH copy when the generated local credential file is missing", () => {
    const { result, calls, shadows } = run(
      "setup-multiple-operators.sh",
      ["1", "password", "--new"],
      { OMIT_GENERATED_FILE: "1" }
    )
    expect(result.status).not.to.equal(0)
    expect(calls).to.deep.equal([])
    expect(shadows).to.deep.equal([])
  })

  for (const selection of [
    "local",
    "invocation-directory",
    "environment-only",
  ]) {
    it(`preserves ${selection} single-operator setup despite PATH shadows`, () => {
      const extra = {}
      let cwd = repo
      if (selection === "invocation-directory") {
        cwd = path.join(directory, "configuration")
        fs.mkdirSync(cwd)
        fs.copyFileSync(path.join(repo, ".env"), path.join(cwd, ".env"))
        fs.copyFileSync(
          path.join(repo, ".env.new-operator"),
          path.join(cwd, ".env.new-operator")
        )
        fs.writeFileSync(path.join(repo, ".env.new-operator"), newConfig(2))
      } else if (selection === "environment-only") {
        fs.unlinkSync(path.join(repo, ".env"))
        fs.unlinkSync(path.join(repo, ".env.new-operator"))
        Object.assign(extra, {
          NEW_STAKING_PROVIDER_ADDRESS: "0x101",
          NEW_STAKING_PROVIDER_KEY: "provider-1",
          NEW_OPERATOR_ADDRESS: "0x201",
          NEW_OPERATOR_KEY: "operator-1",
        })
      }
      const { result, calls, shadows } = run(
        "run-new-operator-setup.sh",
        [],
        extra,
        cwd
      )
      expect(result.status, result.stderr).to.equal(0)
      expect(shadows).to.deep.equal([])
      expect(calls).to.have.lengthOf(8)
      expect(calls[1].args.slice(2, 5)).to.deep.equal([
        "0x101",
        "0x101",
        "0x101",
      ])
      expect(calls[4].args[2]).to.equal("0x201")
      expect(calls[0].key).to.equal("provider-1")
      expect(calls[7].key).to.equal("operator-1")
      expectIntendedCalls(calls)
    })
  }
})

// These stubs only record operations using dummy keys. No Cast executable,
// keystore, public provider, or real wallet generation is used by the flows.
const helpers = `
cast() {
  case "$1" in
    to-wei) python3 - "$2" <<'PY'
import os, sys
from decimal import Decimal
value = int(Decimal(sys.argv[1]) * 10**18)
print(hex(value) if os.environ.get("HEX_CONVERSION") == "1" else value)
PY
      ;;
    from-wei) python3 -c 'import sys; from decimal import Decimal; print(Decimal(sys.argv[1]) / 10**18)' "$2" ;;
    balance) echo "$ETH_BALANCE_WEI" ;;
    call) echo 1000000000000000000000000 ;;
    *) return 90 ;;
  esac
}
derive_address_safe() {
  case "$ETH_PRIVATE_KEY" in
    local-deployer) echo 0xd01 ;;
    provider-*) echo "0x10\${ETH_PRIVATE_KEY#provider-}" ;;
    shadow-provider-*) echo "0x90\${ETH_PRIVATE_KEY#shadow-provider-}" ;;
    *) return 91 ;;
  esac
}
node() {
  [ "$1" = scripts/setup-new-staking-provider.js ] || return 92
  echo "$3" >> "$GENERATION_LOG"
  if [ "\${OMIT_GENERATED_FILE:-0}" != "1" ]; then
    cp "$FIXTURE_DIR/generated-$3.env" "./.env.operator-$3"
  fi
}
cast_send_ok() {
  python3 - "$@" <<'PY'
import json, os, sys
with open(os.environ["CALL_LOG"], "a") as output:
    output.write(json.dumps({"key": os.environ.get("ETH_PRIVATE_KEY"), "args": sys.argv[1:]}) + "\\n")
PY
}
`
