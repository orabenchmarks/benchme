/**
 * What every integrity run does against a live benchme: HTTP through the
 * gateway, a fresh workspace, an account signed up and in (through the pages,
 * or through an app's MCP tools alone), the verifier's answer, and a wrong
 * answer of a key's shape.
 *
 *   const live = liveBenchme({ base, operatorKey });
 *   const ws = await live.mint(scenario, seed);
 *   const cookies = await live.signIn(ws, app, { email, password, name });
 *   const session = await live.toolSession(ws, app, { email, password, signUp });   // an MCP session, signed in
 */

export function liveBenchme({ base, operatorKey }) {
  const BASE = base.replace(/\/$/, "");

  async function http(method, url, { body, form, cookies, headers = {} } = {}) {
    return fetch(url, {
      method,
      redirect: "manual",
      headers: {
        ...headers,
        ...(cookies?.length ? { cookie: cookies.join("; ") } : {}),
        ...(form ? { "content-type": "application/x-www-form-urlencoded" } : body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: form ? new URLSearchParams(form).toString() : body !== undefined ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
    });
  }

  async function mint(scenario, seed) {
    const res = await http("POST", `${BASE}/api/workspaces`, { body: { scenario, seed }, headers: operatorKey ? { "x-benchme-operator-key": operatorKey } : {} });
    if (!res.ok) throw new Error(`workspace mint answered ${res.status}: ${await res.text()}`);
    return (await res.json()).id;
  }

  /** The newest six-digit code an app mailed to an address, from the workspace inbox. */
  async function mailedCode(ws, app, email) {
    const mail = await (await http("GET", `${BASE}/w/${ws}/mail/api/v1/messages`)).json();
    return mail.filter((m) => String(m.to).toLowerCase() === email.toLowerCase() && String(m.from).includes(app)).map((m) => /\b(\d{6})\b/.exec(m.body)?.[1]).filter(Boolean).at(-1);
  }

  /** Session cookies for an existing, verified account, through the pages' own sign-in. */
  async function logIn(ws, app, { email, password }) {
    const login = await http("POST", `${BASE}/w/${ws}/${app}/login`, { form: { email, password } });
    const cookies = login.headers.getSetCookie().map((c) => c.split(";")[0]);
    if (login.status !== 303 || cookies.length === 0) throw new Error(`${app} login as ${email} answered ${login.status} with ${cookies.length} cookies`);
    return cookies;
  }

  /** Session cookies for a new account: sign-up → the code from the workspace inbox → verify → log in. [] for an app without accounts. */
  async function signIn(ws, app, { email, password = `pw-${Math.random().toString(36).slice(2)}-X9`, name = "Integrity" }) {
    const root = `${BASE}/w/${ws}/${app}`;
    const signup = await http("POST", `${root}/signup`, { form: { email, password, name } });
    if (signup.status === 404) return [];
    if (signup.status >= 400) throw new Error(`${app} signup answered ${signup.status}: ${await signup.text()}`);
    const code = await mailedCode(ws, app, email);
    if (!code) throw new Error(`no verification code for ${app} in the workspace inbox`);
    const verify = await http("POST", `${root}/verify`, { form: { email, code } });
    if (verify.status >= 400) throw new Error(`${app} verify answered ${verify.status}`);
    return logIn(ws, app, { email, password });
  }

  /** One JSON-RPC request to an app's MCP server, as an MCP client sends it: the result, and the session id an `initialize` answers with. */
  async function mcp(ws, app, method, params, session) {
    const res = await http("POST", `${BASE}/w/${ws}/${app}/mcp`, { body: { jsonrpc: "2.0", id: 1, method, params }, headers: { accept: "application/json, text/event-stream", ...(session ? { "mcp-session-id": session } : {}) } });
    const text = await res.text();
    if (!res.ok) throw Object.assign(new Error(`${app} mcp ${method} answered ${res.status}: ${text.slice(0, 300)}`), { status: res.status });
    const line = text.split("\n").filter((l) => l.startsWith("data:")).pop();
    const message = JSON.parse(line ? line.slice(5) : text);
    if (message.error) throw new Error(`${app} mcp ${method}: ${JSON.stringify(message.error).slice(0, 300)}`);
    return { result: message.result, session: res.headers.get("mcp-session-id") };
  }

  /** A tool's answer: the JSON it printed, or a throw with the tool's own words when it refused. */
  async function tool(ws, app, name, args, session) {
    const { result } = await mcp(ws, app, "tools/call", { name, arguments: args }, session);
    const said = JSON.parse(result.content[0].text);
    if (result.isError) throw new Error(`${app} ${name} refused: ${JSON.stringify(said).slice(0, 300)}`);
    return said;
  }

  /**
   * An MCP session signed in to an account through the app's tools alone: for
   * a new account sign_up, the mailed code read with the inbox's own tools and
   * verify_email first (`signUp`), then sign_in, and the site's word for who
   * the connection now is.
   */
  async function toolSession(ws, app, { email, password, name = "Integrity", signUp = true }) {
    const { session } = await mcp(ws, app, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "intent-integrity", version: "0" } });
    if (!session) throw new Error(`${app} gave an initializing client no Mcp-Session-Id to stay signed in with`);
    if (signUp) {
      await tool(ws, app, "sign_up", { name, email, password }, session);
      const mail = await tool(ws, "mail", "list_messages", { to: email });
      const code = mail.filter((m) => String(m.from).includes(app)).map((m) => /\b(\d{6})\b/.exec(m.body)?.[1]).filter(Boolean).at(0);
      if (!code) throw new Error(`no verification code for ${app} in the inbox, read through its tools`);
      await tool(ws, app, "verify_email", { email, code }, session);
    }
    await tool(ws, app, "sign_in", { email, password }, session);
    const who = await tool(ws, app, "whoami", {}, session);
    if (who.signedIn !== true || who.email !== email) throw new Error(`${app} says the connection is ${JSON.stringify(who)} after sign_in`);
    return session;
  }

  /**
   * The sign-in of `signIn`, through MCP tools alone (`toolSession`, for a new
   * account). False for an app whose tools do not sign in.
   */
  async function signInThroughTools(ws, app, email) {
    // An app with no MCP server at all (the company's static site) has no tools to sign in with.
    const listed = await mcp(ws, app, "tools/list", {}).catch((err) => (err.status === 404 ? null : Promise.reject(err)));
    if (!listed?.result.tools.some((t) => t.name === "sign_in")) return false;
    await toolSession(ws, app, { email, password: `pw-${Math.random().toString(36).slice(2)}-X9` });
    return true;
  }

  async function submit(ws, id, artifact) {
    const res = await http("POST", `${BASE}/w/${ws}/verify/v1/submit/${id}`, { body: JSON.stringify(artifact) });
    const body = await res.json().catch(() => ({}));
    if (!body.verdict) throw new Error(`verifier answered ${res.status} for ${id}: ${JSON.stringify(body).slice(0, 300)}`);
    return body;
  }

  return { base: BASE, http, mint, mailedCode, logIn, signIn, mcp, tool, toolSession, signInThroughTools, submit, appUrl: (ws, app, path) => `${BASE}/w/${ws}/${app}${path}` };
}

/** A wrong answer of the same shape: every field moved off its key. */
export function perturb(expect) {
  return Object.fromEntries(
    Object.entries(expect).map(([field, v]) => [field, typeof v === "object" ? v.value + v.tolerance * 10 + 1 : typeof v === "number" ? v + 1 : typeof v === "boolean" ? !v : `${v}-not-it`]),
  );
}
