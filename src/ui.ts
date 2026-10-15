// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// The admin dashboard: one static page, plain JS, no build step. The client script avoids backticks so it can live in this template string.

export const adminPage = () => PAGE;

export const privacyPage = () => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Privacy policy</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:42rem;margin:3rem auto;padding:0 1rem;color:#222}</style></head><body>
<h1>Privacy policy</h1>
<p>This is a self-hosted OpenDM instance. It replies to Instagram comments and direct messages on behalf of the account owner who installed it.</p>
<p>It stores, in the owner's own Cloudflare account, the Instagram usernames and IDs of people who comment a keyword or message the account, the text of those messages, and an email address only if the person chooses to send one. Nothing is shared with third parties. The owner can delete any of it from the Cloudflare D1 database.</p>
<p>To have your data removed, message the Instagram account or contact its owner.</p>
<p><small>OpenDM is open source software by SS Enterprises, AGPL-3.0.</small></p></body></html>`;

const PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OpenDM admin</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--ink:#14171f;--mute:#5d6676;--line:#e3e6ec;--brand:#6d4aff;--brand-ink:#fff;--ok:#12805c;--warn:#b25e09;--err:#c0262d}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#181b22;--ink:#e8eaf0;--mute:#98a0b1;--line:#2a2f3a;--brand:#8a6dff;--ok:#3ccf9a;--warn:#f0a24a;--err:#ff6b72}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
header{display:flex;align-items:center;gap:12px;padding:14px 20px;background:var(--card);border-bottom:1px solid var(--line);flex-wrap:wrap}
header h1{font-size:18px;margin:0;letter-spacing:-.01em}header h1 span{color:var(--brand)}
.sp{flex:1}
main{max-width:980px;margin:0 auto;padding:20px}
nav{display:flex;gap:4px;margin-bottom:16px;flex-wrap:wrap}
nav button{background:none;border:0;padding:8px 14px;border-radius:8px;color:var(--mute);font:inherit;cursor:pointer}
nav button.on{background:var(--card);color:var(--ink);box-shadow:0 0 0 1px var(--line);font-weight:600}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px;margin-bottom:16px}
.card h2{font-size:16px;margin:0 0 10px}
.grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}
.stat b{display:block;font-size:26px}.stat span{color:var(--mute);font-size:13px}
label{display:block;font-size:13px;color:var(--mute);margin:12px 0 4px}
input[type=text],input[type=password],input[type=number],textarea,select{width:100%;padding:9px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font:inherit}
textarea{min-height:76px;resize:vertical}
.row{display:flex;gap:12px;flex-wrap:wrap}.row>*{flex:1;min-width:180px}
.chk{display:flex;align-items:center;gap:8px;margin:12px 0 4px;color:var(--ink);font-size:14px}.chk input{width:auto}
button.btn{background:var(--brand);color:var(--brand-ink);border:0;padding:9px 16px;border-radius:8px;font:inherit;font-weight:600;cursor:pointer}
button.btn.ghost{background:none;color:var(--ink);box-shadow:0 0 0 1px var(--line)}
button.btn.danger{background:none;color:var(--err);box-shadow:0 0 0 1px var(--err)}
button.btn:disabled{opacity:.5;cursor:default}
.pill{display:inline-block;padding:2px 10px;border-radius:99px;font-size:12px;font-weight:600;background:var(--line);color:var(--mute)}
.pill.ok{background:color-mix(in srgb,var(--ok) 18%,transparent);color:var(--ok)}.pill.err{background:color-mix(in srgb,var(--err) 18%,transparent);color:var(--err)}.pill.warn{background:color-mix(in srgb,var(--warn) 18%,transparent);color:var(--warn)}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--mute);font-weight:600}
td.t{max-width:380px;word-break:break-word}
.mono{font-family:ui-monospace,Menlo,monospace;font-size:13px;background:var(--bg);padding:2px 6px;border-radius:6px;word-break:break-all}
.hint{color:var(--mute);font-size:13px}
.msg{padding:10px 14px;border-radius:8px;margin:10px 0;font-size:14px}.msg.err{background:color-mix(in srgb,var(--err) 14%,transparent);color:var(--err)}.msg.ok{background:color-mix(in srgb,var(--ok) 14%,transparent);color:var(--ok)}
.chat{display:flex;flex-direction:column;gap:8px;margin-top:12px}
.bub{max-width:78%;padding:9px 13px;border-radius:16px;white-space:pre-wrap;word-break:break-word}
.bub small{display:block;color:var(--mute);font-size:11px;margin-top:3px}
.bub.user{align-self:flex-end;background:var(--brand);color:var(--brand-ink)}.bub.user small{color:#ffffffb0}
.bub.bot{align-self:flex-start;background:var(--bg);border:1px solid var(--line)}
.bub.public{align-self:center;background:color-mix(in srgb,var(--warn) 14%,transparent);font-size:13px}
.bub.system{align-self:center;color:var(--mute);font-size:13px}
.switch{display:flex;align-items:center;gap:8px;font-size:14px}.switch input{width:38px;height:22px;accent-color:var(--brand)}
#login{max-width:360px;margin:12vh auto}
[hidden]{display:none!important}
details{margin-top:10px}summary{cursor:pointer;color:var(--mute)}
</style>
</head>
<body>
<div id="login" class="card" hidden>
  <h1 style="margin-top:0">Open<span style="color:var(--brand)">DM</span></h1>
  <p class="hint">Admin login</p>
  <form id="login-form">
    <label for="password">Password</label>
    <input id="password" type="password" autocomplete="current-password" autofocus>
    <div id="login-err" class="msg err" hidden></div>
    <p><button class="btn" type="submit" id="login-btn">Log in</button></p>
  </form>
</div>

<div id="app" hidden>
<header>
  <h1>Open<span>DM</span></h1>
  <span id="conn-pill" class="pill">...</span>
  <div class="sp"></div>
  <label class="switch" style="margin:0"><input type="checkbox" id="enabled"> <span id="enabled-label">Automation on</span></label>
  <button class="btn ghost" id="logout">Log out</button>
</header>
<main>
  <nav id="tabs">
    <button data-tab="overview" class="on">Overview</button>
    <button data-tab="rules">Rules</button>
    <button data-tab="test">Test</button>
    <button data-tab="log">Log</button>
  </nav>
  <div id="flash" class="msg" hidden></div>

  <section id="tab-overview">
    <div class="grid" id="stats"></div>
    <div class="card" style="margin-top:16px">
      <h2>Instagram account</h2>
      <div id="connect-view"></div>
    </div>
    <div class="card">
      <h2>Webhook</h2>
      <p class="hint">In your Meta app (Instagram Login, Webhooks) use these two values, then subscribe to <b>comments</b> and <b>messages</b>.</p>
      <label>Callback URL</label><div class="mono" id="webhook-url"></div>
      <label>Verify token</label><div class="hint">The <span class="mono">VERIFY_TOKEN</span> secret you set when deploying.</div>
    </div>
    <div class="card">
      <h2>Sending limit</h2>
      <p class="hint">Messages beyond this many per rolling hour wait in a queue and go out as the hour frees up. <span id="limit-now"></span></p>
      <div class="row" style="align-items:end"><div><label for="hourly">Max sends per hour</label><input type="number" id="hourly" min="1" max="5000"></div><div><button class="btn ghost" id="save-limit">Save limit</button></div></div>
    </div>
  </section>

  <section id="tab-rules" hidden>
    <div class="card">
      <div class="row" style="align-items:center"><h2 style="margin:0">Keyword rules</h2><div style="text-align:right"><button class="btn" id="new-rule">New rule</button></div></div>
      <div id="rules-list"></div>
    </div>
    <div class="card" id="editor" hidden>
      <h2 id="editor-title">New rule</h2>
      <div class="row">
        <div><label for="f-name">Name</label><input type="text" id="f-name" placeholder="Free guide"></div>
        <div><label for="f-keywords">Keywords (comma separated)</label><input type="text" id="f-keywords" placeholder="GUIDE, LINK"></div>
      </div>
      <div class="row">
        <div><label for="f-link">Link to send ({link})</label><input type="text" id="f-link" placeholder="https://example.com/guide"></div>
        <div><label for="f-media">Only on this post (media ID, optional)</label><input type="text" id="f-media" placeholder="all posts"></div>
      </div>
      <label for="f-replies">Public comment replies (one per line, rotated; leave empty for the defaults)</label>
      <textarea id="f-replies" placeholder="Sent you a DM!"></textarea>
      <div class="row"><label class="chk"><input type="checkbox" id="f-fuzzy"> Allow small typos in the keyword</label><label class="chk"><input type="checkbox" id="f-enabled"> Rule enabled</label></div>
      <p class="hint">Placeholders: <span class="mono">{name}</span> <span class="mono">{keyword}</span> <span class="mono">{link}</span> <span class="mono">{account}</span></p>

      <h2 style="margin-top:22px">Conversation</h2>
      <label class="chk"><input type="checkbox" id="fl-opener"> Opener first (private reply asks "want it?", the link follows after they reply)</label>
      <label for="fl-openerText">Opener message</label><textarea id="fl-openerText"></textarea>
      <label class="chk"><input type="checkbox" id="fl-requireFollow"> Follow gate</label>
      <label for="fl-followText">Follow request</label><textarea id="fl-followText"></textarea>
      <details><summary>Follow gate details</summary>
        <label for="fl-followRetryText">Not following yet</label><textarea id="fl-followRetryText"></textarea>
        <div class="row">
          <div><label for="fl-followMaxTries">Tries before giving up</label><input type="number" id="fl-followMaxTries" min="1" max="5"></div>
          <div><label for="fl-followGiveUp">After the tries</label><select id="fl-followGiveUp"><option value="send">Send the link anyway</option><option value="stop">Stop politely</option></select></div>
          <div><label for="fl-followTimeoutMin">No answer after (minutes)</label><input type="number" id="fl-followTimeoutMin" min="2" max="600"></div>
        </div>
        <label for="fl-followTimeoutText">Message when no answer (the link goes out anyway)</label><textarea id="fl-followTimeoutText"></textarea>
        <label for="fl-followStopText">Message when stopping</label><textarea id="fl-followStopText"></textarea>
      </details>
      <label for="fl-askEmail">Email capture</label>
      <select id="fl-askEmail"><option value="off">Off</option><option value="optional">Ask, they may skip</option><option value="required">Required before the link</option></select>
      <details><summary>Email messages</summary>
        <label for="fl-emailText">Ask</label><textarea id="fl-emailText"></textarea>
        <label for="fl-emailRetryText">Not an email</label><textarea id="fl-emailRetryText"></textarea>
        <label for="fl-emailThanks">Thanks</label><textarea id="fl-emailThanks"></textarea>
      </details>
      <label for="fl-deliverText">Final message with the link</label><textarea id="fl-deliverText"></textarea>
      <div id="editor-err" class="msg err" hidden></div>
      <p style="margin-top:16px"><button class="btn" id="save-rule">Save rule</button> <button class="btn ghost" id="cancel-rule">Cancel</button></p>
    </div>
  </section>

  <section id="tab-test" hidden>
    <div class="card">
      <h2>Dry run</h2>
      <p class="hint">Type a comment and see exactly what the bot would send. Nothing is sent to Instagram.</p>
      <div class="row"><div><label for="t-comment">Comment</label><input type="text" id="t-comment" placeholder="GUIDE please"></div><div><label for="t-name">First name (optional)</label><input type="text" id="t-name" placeholder="Sam"></div></div>
      <label for="t-replies">What the person replies next (one per line)</label>
      <textarea id="t-replies" placeholder="yes&#10;done&#10;me@example.com"></textarea>
      <div class="row">
        <div><label for="t-following">Follow check result</label><select id="t-following"><option value="unknown">Unknown (Meta can't tell)</option><option value="yes">They follow</option><option value="no">They don't follow</option></select></div>
        <div><label for="t-wait">Then wait (minutes, no reply)</label><input type="number" id="t-wait" min="0" placeholder="0"></div>
      </div>
      <p><button class="btn" id="t-run">Run test</button></p>
      <div id="t-out"></div>
    </div>
  </section>

  <section id="tab-log" hidden>
    <div class="card">
      <div class="row" style="align-items:center"><h2 style="margin:0">Event log</h2><div style="text-align:right"><button class="btn ghost" id="log-refresh">Refresh</button></div></div>
      <div style="overflow-x:auto"><table><thead><tr><th>Time</th><th>Type</th><th>Status</th><th>Who</th><th>Keyword</th><th>Text / detail</th></tr></thead><tbody id="log-body"></tbody></table></div>
    </div>
  </section>
</main>
</div>

<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var state = { status: null, rules: [], editing: null };
  var FLOW_TEXT = ["openerText","followText","followRetryText","followTimeoutText","followStopText","emailText","emailRetryText","emailThanks","deliverText"];
  var FLOW_NUM = ["followMaxTries","followTimeoutMin"];
  var FLOW_SEL = ["followGiveUp","askEmail"];
  var FLOW_BOOL = ["opener","requireFollow"];

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); }
  function api(method, path, body) {
    var opts = { method: method, headers: {}, credentials: "same-origin" };
    if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    else if (method !== "GET") { opts.headers["Content-Type"] = "application/json"; opts.body = "{}"; }
    return fetch(path, opts).then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (r.status === 401 && path !== "/api/login") { showLogin(); } if (!r.ok) { var e = new Error(d.error || ("HTTP " + r.status)); e.status = r.status; throw e; } return d; }); });
  }
  function flash(text, kind) { var f = $("flash"); f.textContent = text; f.className = "msg " + (kind || "ok"); f.hidden = false; clearTimeout(flash.t); flash.t = setTimeout(function () { f.hidden = true; }, 5000); }
  function ago(ts) { var s = Math.round((Date.now() - ts) / 1000); if (s < 60) return s + "s ago"; if (s < 3600) return Math.round(s / 60) + "m ago"; if (s < 86400) return Math.round(s / 3600) + "h ago"; return Math.round(s / 86400) + "d ago"; }

  function showLogin() { $("app").hidden = true; $("login").hidden = false; $("password").focus(); }
  function showApp() { $("login").hidden = true; $("app").hidden = false; refreshAll(); }

  $("login-form").addEventListener("submit", function (e) {
    e.preventDefault();
    $("login-err").hidden = true;
    api("POST", "/api/login", { password: $("password").value }).then(function () { $("password").value = ""; showApp(); }).catch(function (err) { $("login-err").textContent = err.message; $("login-err").hidden = false; });
  });
  $("logout").addEventListener("click", function () { api("POST", "/api/logout").then(showLogin); });

  document.querySelectorAll("#tabs button").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll("#tabs button").forEach(function (x) { x.classList.toggle("on", x === b); });
      ["overview","rules","test","log"].forEach(function (t) { $("tab-" + t).hidden = t !== b.dataset.tab; });
      if (b.dataset.tab === "log") loadLog();
      if (b.dataset.tab === "rules") loadRules();
    });
  });

  // ---- overview -----------------------------------------------------------------------------------------------
  function renderStatus() {
    var s = state.status;
    var pill = $("conn-pill");
    pill.textContent = s.connected ? "@" + (s.username || s.igId) + " connected" : "Not connected";
    pill.className = "pill " + (s.connected ? (s.tokenError ? "warn" : "ok") : "err");
    $("enabled").checked = s.enabled;
    $("enabled-label").textContent = s.enabled ? "Automation on" : "Automation off";
    var c = s.conversations || {};
    $("stats").innerHTML = [["Rules", s.rules], ["Messages sent (24h)", s.sent24h], ["Sent this hour", s.sentLastHour + " / " + s.hourlyLimit], ["Waiting on a reply", (c.opened || 0) + (c.awaiting_follow || 0) + (c.awaiting_email || 0)], ["Finished", c.done || 0]]
      .map(function (x) { return '<div class="card stat" style="margin:0"><b>' + esc(x[1]) + '</b><span>' + esc(x[0]) + '</span></div>'; }).join("");
    $("webhook-url").textContent = s.webhookUrl;
    $("hourly").value = s.hourlyLimit;
    $("limit-now").textContent = "Sent in the last hour: " + s.sentLastHour + ".";
    var cv = $("connect-view");
    if (s.connected) {
      cv.innerHTML = '<p>Connected as <b>@' + esc(s.username || "") + '</b> <span class="hint">(id ' + esc(s.igId) + ')</span></p>' +
        (s.tokenError ? '<div class="msg err">Token problem: ' + esc(s.tokenError) + ' Reconnect below.</div>' : '') +
        (s.tokenExpires ? '<p class="hint">Token expires ' + new Date(s.tokenExpires).toLocaleDateString() + ' (refreshed automatically).</p>' : '') +
        '<p><button class="btn" id="subscribe">Subscribe to comments + messages</button> <button class="btn danger" id="disconnect">Disconnect</button></p>';
      $("subscribe").onclick = function () { api("POST", "/api/subscribe").then(function () { flash("Subscribed to comments and messages"); }).catch(function (e) { flash(e.message, "err"); }); };
      $("disconnect").onclick = function () { if (confirm("Disconnect this account?")) api("POST", "/api/disconnect").then(refreshAll); };
    } else {
      cv.innerHTML = (s.oauthAvailable ? '<p><a class="btn" style="display:inline-block;text-decoration:none" id="oauth" href="/admin/oauth/start">Connect with Instagram</a></p><p class="hint">or paste a token:</p>' : '<p class="hint">Paste an Instagram user access token (Meta app, Instagram Login, API setup, Generate token).</p>') +
        '<label for="token">Access token</label><input type="password" id="token" autocomplete="off" placeholder="IGAA..."><p><button class="btn" id="connect">Connect</button></p><div id="connect-err" class="msg err" hidden></div>';
      $("connect").onclick = function () {
        $("connect-err").hidden = true; $("connect").disabled = true;
        api("POST", "/api/connect", { token: $("token").value }).then(function () { flash("Account connected"); refreshAll(); }).catch(function (e) { $("connect-err").textContent = e.message; $("connect-err").hidden = false; $("connect").disabled = false; });
      };
    }
  }
  function refreshAll() { return api("GET", "/api/status").then(function (s) { state.status = s; renderStatus(); loadRules(); }).catch(function () {}); }
  $("enabled").addEventListener("change", function () { api("POST", "/api/enabled", { enabled: $("enabled").checked }).then(refreshAll); });
  $("save-limit").addEventListener("click", function () { api("POST", "/api/settings", { hourlyLimit: Number($("hourly").value) }).then(function () { flash("Limit saved"); refreshAll(); }).catch(function (e) { flash(e.message, "err"); }); });

  // ---- rules --------------------------------------------------------------------------------------------------
  function loadRules() {
    return api("GET", "/api/rules").then(function (d) {
      state.rules = d.rules;
      var el = $("rules-list");
      if (!d.rules.length) { el.innerHTML = '<p class="hint">No rules yet. Create one to start replying to comments.</p>'; return; }
      el.innerHTML = '<table><thead><tr><th>Name</th><th>Keywords</th><th>Link</th><th>On</th><th></th></tr></thead><tbody>' + d.rules.map(function (r) {
        return '<tr data-rule="' + r.id + '"><td><b>' + esc(r.name) + '</b>' + (r.media_id ? '<br><span class="hint">post ' + esc(r.media_id) + '</span>' : '') + '</td><td>' + r.keywords.map(function (k) { return '<span class="mono">' + esc(k) + '</span>'; }).join(" ") + '</td><td class="t">' + esc(r.link) + '</td><td><span class="pill ' + (r.enabled ? "ok" : "") + '">' + (r.enabled ? "on" : "off") + '</span></td><td style="white-space:nowrap"><button class="btn ghost" data-edit="' + r.id + '">Edit</button> <button class="btn danger" data-del="' + r.id + '">Delete</button></td></tr>';
      }).join("") + '</tbody></table>';
      el.querySelectorAll("[data-edit]").forEach(function (b) { b.onclick = function () { openEditor(state.rules.filter(function (r) { return r.id == b.dataset.edit; })[0]); }; });
      el.querySelectorAll("[data-del]").forEach(function (b) { b.onclick = function () { if (confirm("Delete this rule?")) api("DELETE", "/api/rules/" + b.dataset.del).then(loadRules).then(refreshAll); }; });
    });
  }
  function openEditor(rule) {
    var defaults = state.status.defaults.flow, flow = rule ? rule.flow : defaults;
    state.editing = rule ? rule.id : null;
    $("editor-title").textContent = rule ? "Edit rule" : "New rule";
    $("f-name").value = rule ? rule.name : ""; $("f-keywords").value = rule ? rule.keywords.join(", ") : "";
    $("f-link").value = rule ? rule.link : ""; $("f-media").value = rule ? rule.media_id || "" : "";
    $("f-replies").value = rule ? rule.public_replies.join("\n") : "";
    $("f-fuzzy").checked = rule ? rule.fuzzy : true; $("f-enabled").checked = rule ? rule.enabled : true;
    FLOW_TEXT.concat(FLOW_NUM, FLOW_SEL).forEach(function (k) { $("fl-" + k).value = flow[k]; });
    FLOW_BOOL.forEach(function (k) { $("fl-" + k).checked = !!flow[k]; });
    $("editor-err").hidden = true; $("editor").hidden = false; $("f-name").focus(); $("editor").scrollIntoView({ behavior: "smooth" });
  }
  $("new-rule").onclick = function () { openEditor(null); };
  $("cancel-rule").onclick = function () { $("editor").hidden = true; };
  $("save-rule").onclick = function () {
    var flow = {};
    FLOW_TEXT.forEach(function (k) { flow[k] = $("fl-" + k).value; });
    FLOW_NUM.forEach(function (k) { flow[k] = Number($("fl-" + k).value); });
    FLOW_SEL.forEach(function (k) { flow[k] = $("fl-" + k).value; });
    FLOW_BOOL.forEach(function (k) { flow[k] = $("fl-" + k).checked; });
    var body = { name: $("f-name").value, keywords: $("f-keywords").value, link: $("f-link").value, media_id: $("f-media").value, public_replies: $("f-replies").value, fuzzy: $("f-fuzzy").checked, enabled: $("f-enabled").checked, flow: flow };
    var req = state.editing ? api("PUT", "/api/rules/" + state.editing, body) : api("POST", "/api/rules", body);
    req.then(function () { $("editor").hidden = true; flash("Rule saved"); loadRules(); refreshAll(); }).catch(function (e) { $("editor-err").textContent = e.message; $("editor-err").hidden = false; });
  };

  // ---- test ---------------------------------------------------------------------------------------------------
  $("t-run").onclick = function () {
    api("POST", "/api/test", { comment: $("t-comment").value, name: $("t-name").value, replies: $("t-replies").value, following: $("t-following").value, waitMinutes: Number($("t-wait").value) || 0 }).then(function (d) {
      $("t-out").innerHTML = (d.matched ? '<p class="msg ok" id="t-matched">Matched rule: <b>' + esc(d.rule.name) + '</b>. Conversation ends at step: <b>' + esc(d.finalStep) + '</b></p>' : '<p class="msg err" id="t-matched">No rule matched</p>') +
        '<div class="chat" id="t-chat">' + d.transcript.map(function (m) { return '<div class="bub ' + esc(m.from) + '">' + esc(m.text) + (m.note ? '<small>' + esc(m.note) + '</small>' : '') + '</div>'; }).join("") + '</div>';
    }).catch(function (e) { flash(e.message, "err"); });
  };

  // ---- log ----------------------------------------------------------------------------------------------------
  function loadLog() {
    return api("GET", "/api/log?limit=100").then(function (d) {
      $("log-body").innerHTML = d.events.length ? d.events.map(function (e) {
        var cls = e.status === "sent" ? "ok" : e.status === "error" ? "err" : e.status === "queued" ? "warn" : "";
        return '<tr><td title="' + esc(new Date(e.ts).toISOString()) + '">' + esc(ago(e.ts)) + '</td><td>' + esc(e.kind) + '</td><td><span class="pill ' + cls + '">' + esc(e.status) + '</span></td><td>' + esc(e.username ? "@" + e.username : e.ig_user || "") + '</td><td>' + esc(e.keyword || "") + '</td><td class="t">' + esc(e.text || "") + (e.error ? '<br><span class="hint">' + esc(e.error) + '</span>' : '') + '</td></tr>';
      }).join("") : '<tr><td colspan="6" class="hint">No events yet.</td></tr>';
    });
  }
  $("log-refresh").onclick = loadLog;

  api("GET", "/api/status").then(function () { showApp(); }).catch(function () { showLogin(); });
  if (location.hash.length > 1) { setTimeout(function () { flash(decodeURIComponent(location.hash.slice(1)), /fail|invalid|could not|said/i.test(location.hash) ? "err" : "ok"); history.replaceState(null, "", "/admin"); }, 600); }
})();
</script>
</body>
</html>`;
