// Integration checks for overridden dependencies and their retained callers.
// All network peers and fixtures are local; no chain or service credentials are used.
const assert = require("node:assert/strict")
const fs = require("node:fs")
const http = require("node:http")
const net = require("node:net")
const os = require("node:os")
const path = require("node:path")
const { createRequire } = require("node:module")
const { once } = require("node:events")
const { test } = require("node:test")

// Resolve from the caller, so a hoisted copy cannot hide a broken nested override.
const fromPackage = (name) =>
  createRequire(require.resolve(`${name}/package.json`))
const hardhatRequire = fromPackage("hardhat")
const { Pool, ProxyAgent, request } = hardhatRequire("undici")
const { HttpProvider } = require("hardhat/internal/core/providers/http")

function fixtureDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tooling-compat-"))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return directory
}

async function localServer(t, handler) {
  const server = http.createServer(handler)
  const sockets = new Set()
  server.on("connection", (socket) => {
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
  })
  t.after(async () => {
    const closed = new Promise((resolve) => server.close(resolve))
    for (const socket of sockets) socket.destroy()
    await closed
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  return { server, url: `http://127.0.0.1:${server.address().port}` }
}

function jsonResponse(response, value, statusCode = 200) {
  response.writeHead(statusCode, { "content-type": "application/json" })
  response.end(JSON.stringify(value))
}

function rpcResult(payload) {
  if (payload.method === "test_error") {
    return {
      jsonrpc: "2.0",
      id: payload.id,
      error: {
        code: -32001,
        message: "fixture failure",
        data: "fixture detail",
      },
    }
  }
  return { jsonrpc: "2.0", id: payload.id, result: payload.params[0] }
}

test(
  "Hardhat HTTP provider preserves RPC, reused connections, batches and errors",
  { timeout: 10000 },
  async (t) => {
    const sockets = new Set()
    const { url } = await localServer(t, (incoming, response) => {
      sockets.add(incoming.socket)
      let body = ""
      incoming.on("data", (chunk) => {
        body += chunk
      })
      incoming.on("end", () => {
        const payload = JSON.parse(body)
        jsonResponse(
          response,
          Array.isArray(payload)
            ? payload.map(rpcResult).reverse()
            : rpcResult(payload)
        )
      })
    })
    const pool = new Pool(url, { connections: 1 })
    t.after(() => pool.destroy())
    const provider = new HttpProvider(`${url}/rpc`, "fixture", {}, 2000, pool)
    assert.deepEqual(
      await provider.request({ method: "echo", params: [{ value: 1 }] }),
      { value: 1 }
    )
    assert.equal(
      await provider.request({ method: "echo", params: ["second"] }),
      "second"
    )
    assert.deepEqual(
      await provider.sendBatch([
        { method: "echo", params: ["first"] },
        { method: "echo", params: ["second"] },
      ]),
      ["first", "second"]
    )
    await assert.rejects(
      provider.request({ method: "test_error" }),
      (error) => {
        assert.equal(error.code, -32001)
        assert.equal(error.message, "fixture failure")
        assert.equal(error.data, "fixture detail")
        return true
      }
    )
    assert.equal(
      sockets.size,
      1,
      "sequential RPC calls should reuse the connection"
    )
  }
)

test(
  "Hardhat downloader follows redirects, preserves bytes and reports HTTP errors",
  { timeout: 10000 },
  async (t) => {
    const { download } = require("hardhat/internal/util/download")
    const bytes = Buffer.from([0, 1, 2, 128, 255, 10])
    let receivedHeader
    const { url } = await localServer(t, (incoming, response) => {
      if (incoming.url === "/redirect") {
        response.writeHead(302, { location: "/compiler" })
        response.end()
      } else if (incoming.url === "/compiler") {
        receivedHeader = incoming.headers["x-fixture"]
        response.end(bytes)
      } else {
        response.writeHead(404)
        response.end("missing fixture")
      }
    })
    const directory = fixtureDirectory(t)
    const output = path.join(directory, "nested", "compiler")
    await download(`${url}/redirect`, output, 2000, { "x-fixture": "download" })
    assert.deepEqual(fs.readFileSync(output), bytes)
    assert.equal(receivedHeader, "download")
    const missingOutput = path.join(directory, "missing")
    await assert.rejects(
      download(`${url}/missing`, missingOutput, 2000),
      /404.*missing fixture/
    )
    assert.equal(fs.existsSync(missingOutput), false)
  }
)

test(
  "Undici ProxyAgent carries a request through a localhost CONNECT tunnel",
  { timeout: 10000 },
  async (t) => {
    const target = await localServer(t, (incoming, response) => {
      jsonResponse(response, {
        path: incoming.url,
        header: incoming.headers["x-fixture"],
      })
    })
    const proxy = await localServer(t)
    const tunnels = new Set()
    const authorities = []
    proxy.server.on("connect", (incoming, client, head) => {
      authorities.push(incoming.url)
      // The destination is fixed to our fixture, never derived from request input.
      const upstream = net.connect(
        target.server.address().port,
        "127.0.0.1",
        () => {
          client.write("HTTP/1.1 200 Connection Established\r\n\r\n")
          if (head.length) upstream.write(head)
          client.pipe(upstream)
          upstream.pipe(client)
        }
      )
      tunnels.add(upstream)
      upstream.on("close", () => tunnels.delete(upstream))
      upstream.on("error", () => client.destroy())
      client.on("error", () => upstream.destroy())
      client.on("close", () => upstream.destroy())
    })
    const dispatcher = new ProxyAgent(proxy.url)
    t.after(async () => {
      for (const socket of tunnels) socket.destroy()
      await dispatcher.destroy()
    })
    const response = await request(`${target.url}/proxied`, {
      dispatcher,
      headersTimeout: 2000,
      headers: { "x-fixture": "proxy" },
    })
    assert.equal(response.statusCode, 200)
    assert.deepEqual(await response.body.json(), {
      path: "/proxied",
      header: "proxy",
    })
    assert.deepEqual(authorities, [new URL(target.url).host])
  }
)

test("Hardhat's ZIP dependency extracts a valid compiler-style archive", (t) => {
  const AdmZip = hardhatRequire("adm-zip")
  const directory = fixtureDirectory(t)
  const archive = new AdmZip()
  const binary = Buffer.from([77, 90, 0, 255, 1, 2])
  archive.addFile("solc.exe", binary)
  archive.addFile("licenses/compiler.txt", Buffer.from("fixture license\n"))
  const archivePath = path.join(directory, "compiler.zip")
  archive.writeZip(archivePath)
  const output = path.join(directory, "extracted")
  new AdmZip(archivePath).extractAllTo(output)
  assert.deepEqual(fs.readFileSync(path.join(output, "solc.exe")), binary)
  assert.equal(
    fs.readFileSync(path.join(output, "licenses/compiler.txt"), "utf8"),
    "fixture license\n"
  )
})

test(
  "Mocha passes RegExp and timing options through its actual worker serializer",
  { timeout: 10000 },
  async (t) => {
    const { BufferedWorkerPool } = hardhatRequire(
      "mocha/lib/nodejs/buffered-worker-pool"
    )
    const directory = fixtureDirectory(t)
    const fixture = path.join(directory, "options.cjs")
    fs.writeFileSync(
      fixture,
      `
    const assert = require("node:assert/strict")
    it("retained option fixture", function () {
      assert.equal(this.timeout(), 1234)
      assert.equal(this.slow(), 87)
    })
    it("excluded option fixture", function () {
      throw new Error("grep option was not preserved")
    })
  `
    )
    const pool = BufferedWorkerPool.create({
      maxWorkers: 1,
      forkOpts: { execArgv: [] },
    })
    t.after(() => pool.terminate(true))
    const result = await pool.run(fixture, {
      grep: /^RETAINED/i,
      timeout: 1234,
      slow: 87,
      reporter: hardhatRequire.resolve(
        "mocha/lib/nodejs/reporters/parallel-buffered"
      ),
    })
    assert.equal(result.failureCount, 0)
    assert.equal(
      result.events.filter((event) => event.eventName === "pass").length,
      1
    )
  }
)

test("solc's tmp.fileSync preserves the SMT file lifecycle", (t) => {
  const tmp = fromPackage("solc")("tmp")
  const file = tmp.fileSync({ postfix: ".smt2" })
  t.after(() => file.removeCallback())
  assert.equal(path.extname(file.name), ".smt2")
  assert.equal(typeof file.fd, "number")
  fs.writeFileSync(file.name, "(check-sat)\n")
  assert.equal(fs.readFileSync(file.name, "utf8"), "(check-sat)\n")
  file.removeCallback()
  assert.equal(fs.existsSync(file.name), false)
})

test("Mocha renders assertion differences with unified and inline diff APIs", () => {
  const Base = hardhatRequire("mocha/lib/reporters/base")
  const { useColors, inlineDiffs } = Base
  try {
    Base.useColors = false
    Base.inlineDiffs = false
    const unified = Base.generateDiff("keep\nold\n", "keep\nnew\n")
    assert.match(unified, /-old/)
    assert.match(unified, /\+new/)
    Base.inlineDiffs = true
    const inline = Base.generateDiff("a red item", "a blue item")
    assert.match(inline, /red/)
    assert.match(inline, /blue/)
    assert.match(inline, /item/)
  } finally {
    Base.useColors = useColors
    Base.inlineDiffs = inlineDiffs
  }
})

for (const caller of [
  "hardhat-deploy",
  "@tenderly/hardhat-tenderly",
  "tenderly",
  "@openzeppelin/platform-deploy-client",
]) {
  test(
    `${caller}'s axios preserves JSON POST redirects and response errors`,
    { timeout: 10000 },
    async (t) => {
      const axios = fromPackage(caller)("axios")
      const { url } = await localServer(t, (incoming, response) => {
        if (incoming.url === "/redirect") {
          response.writeHead(307, { location: "/echo" })
          incoming.resume()
          response.end()
        } else if (incoming.url === "/forbidden") {
          jsonResponse(response, { error: "fixture denial" }, 403)
        } else {
          let body = ""
          incoming.on("data", (chunk) => {
            body += chunk
          })
          incoming.on("end", () =>
            jsonResponse(response, {
              method: incoming.method,
              body: JSON.parse(body),
              header: incoming.headers["x-fixture"],
            })
          )
        }
      })
      const client = axios.create({ baseURL: url, timeout: 2000, proxy: false })
      const response = await client.post(
        "/redirect",
        { contract: "fixture", value: 7 },
        {
          headers: { "x-fixture": caller },
          maxRedirects: 3,
        }
      )
      assert.deepEqual(response.data, {
        method: "POST",
        body: { contract: "fixture", value: 7 },
        header: caller,
      })
      await assert.rejects(client.get("/forbidden"), (error) => {
        assert.equal(axios.isAxiosError(error), true)
        assert.equal(error.response.status, 403)
        assert.deepEqual(error.response.data, { error: "fixture denial" })
        return true
      })
    }
  )
}

test(
  "ethers WebSocketProvider exchanges RPC requests and block subscriptions",
  { timeout: 10000 },
  async (t) => {
    const providersRequire = fromPackage("@ethersproject/providers")
    const { WebSocketServer } = providersRequire("ws")
    const { WebSocketProvider } = require("@ethersproject/providers")
    const fixture = await localServer(t)
    const server = new WebSocketServer({ server: fixture.server })
    t.after(() => {
      for (const socket of server.clients) socket.terminate()
      return new Promise((resolve) => server.close(resolve))
    })
    let subscribed
    const subscription = new Promise((resolve) => {
      subscribed = resolve
    })
    server.on("connection", (socket) => {
      socket.on("message", (message) => {
        const payload = JSON.parse(message.toString())
        let result
        if (payload.method === "eth_chainId") result = "0x539"
        else if (payload.method === "eth_blockNumber") result = "0x7b"
        else if (payload.method === "eth_subscribe")
          result = "fixture-subscription"
        else if (payload.method === "eth_unsubscribe") result = true
        else {
          socket.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: payload.id,
              error: { code: -32601, message: "fixture unknown method" },
            })
          )
          return
        }
        socket.send(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result }))
        if (payload.method === "eth_subscribe") subscribed(socket)
      })
    })
    const provider = new WebSocketProvider(fixture.url.replace("http:", "ws:"))
    t.after(() => provider.destroy())
    assert.equal((await provider.getNetwork()).chainId, 1337)
    assert.equal(await provider.getBlockNumber(), 123)
    await assert.rejects(
      provider.send("fixture_unknown", []),
      (error) => error.code === -32601
    )
    const block = new Promise((resolve) => provider.once("block", resolve))
    const socket = await subscription
    // A subsequent RPC response confirms the subscription response was consumed.
    await provider.send("eth_blockNumber", [])
    socket.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_subscription",
        params: {
          subscription: "fixture-subscription",
          result: { number: "0x7c" },
        },
      })
    )
    assert.equal(await block, 124)
  }
)

test(
  "Tenderly's Express parses nested queries and URL-encoded form bodies",
  { timeout: 10000 },
  async (t) => {
    const express = fromPackage("tenderly")("express")
    const app = express()
    app.set("query parser", "extended")
    app.use(express.urlencoded({ extended: true }))
    app.get("/", (incoming, response) => response.json(incoming.query))
    app.post("/", (incoming, response) => response.json(incoming.body))
    const { url } = await localServer(t, app)
    const dispatcher = new Pool(url, { connections: 1 })
    t.after(() => dispatcher.destroy())
    const encoded = "project[name]=fixture&tags[]=alpha&tags[]=beta"
    const expected = { project: { name: "fixture" }, tags: ["alpha", "beta"] }
    const query = await request(`${url}/?${encoded}`, { dispatcher })
    assert.equal(query.statusCode, 200)
    assert.deepEqual(await query.body.json(), expected)
    const form = await request(`${url}/`, {
      dispatcher,
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: encoded,
    })
    assert.equal(form.statusCode, 200)
    assert.deepEqual(await form.body.json(), expected)
  }
)

test("ESLint and Tenderly retain their respective YAML load/dump APIs", () => {
  const yaml3 = fromPackage("eslint")("js-yaml")
  const yaml4 = fromPackage("@tenderly/hardhat-tenderly")("js-yaml")
  const source =
    "defaults: &defaults\n  timeout: 60000\njob:\n  <<: *defaults\n  network: fixture\n"
  for (const [load, dump] of [
    [yaml3.safeLoad, yaml3.safeDump],
    [yaml4.load, yaml4.dump],
  ]) {
    const config = load(source)
    assert.deepEqual(config.job, { timeout: 60000, network: "fixture" })
    assert.deepEqual(load(dump(config)), config)
    assert.throws(() => load("value: [unterminated"))
  }
})
