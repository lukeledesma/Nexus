# Dependency Security Audit Report
**Generated:** 2026-05-13  
**Tool:** bundler-audit (ruby-advisory-db commit `dad0a89`, updated 2026-05-12)  
**Application:** Nexus_Dev (Rails 8.1.2)

---

## A. Summary of All Issues

| Gem | Current Version | Required Version | Unique CVEs/GHSAs | Highest Severity |
|---|---|---|---|---|
| actionpack | 8.1.2 | >= 8.1.2.1 | 1 | Unknown (XSS) |
| actionview | 8.1.2 | >= 8.1.2.1 | 1 | Unknown (XSS) |
| activestorage | 8.1.2 | >= 8.1.2.1 | 4 | Unknown (Path Traversal, Glob Injection) |
| activesupport | 8.1.2 | >= 8.1.2.1 | 3 | Unknown (ReDoS, XSS, DoS) |
| addressable | 2.8.9 | >= 2.9.0 | 1 | **High** (ReDoS) |
| nokogiri | 1.19.1 | >= 1.19.3 | 2 | **High** (ReDoS) |
| rack | 3.2.5 | >= 3.2.6 | 11 | **High** (file exposure, DoS, unbounded upload) |
| rack-session | 2.1.1 | >= 2.1.2 | 1 | Unknown (session forgery + unsafe deserialization) |

**Total unique vulnerabilities: 24**  
**Duplicates in audit output:** nokogiri's two GHSAs each appear 3× (6 duplicate entries removed from analysis below).

> **Immediate action required on all items.** Although bundler-audit lists several Rails CVEs as "Unknown" criticality (the advisory DB hasn't yet assigned a CVSS score), the vulnerability classes — XSS, Path Traversal, glob injection, and Marshal deserialization — are inherently high-risk in production web applications. Treat them as **High**.

---

## B. Detailed Vulnerability List

### B1. Rails Core Gems — upgrade to 8.1.2.1 (single `bundle update rails`)

All six gems below share the same version constraint and are fixed in the same patch release.

---

**B1a. actionpack 8.1.2**  
CVE: `CVE-2026-33167` · GHSA: `GHSA-pgm4-439c-5jp6`  
Severity: Unknown (treat as High)  
Title: XSS vulnerability in Action Pack debug exceptions page  
Explanation: The debug exceptions middleware renders exception details without properly escaping user-controlled input, allowing a crafted request to inject arbitrary HTML/JS into the error page. Relevant in development mode and any environment that exposes the debug page.  
Fix type: Direct upgrade, no code changes required.

---

**B1b. actionview 8.1.2**  
CVE: `CVE-2026-33168` · GHSA: `GHSA-v55j-83pf-r9cq`  
Severity: Unknown (treat as High)  
Title: XSS vulnerability in Action View tag helpers  
Explanation: Certain tag helper methods fail to sanitize attribute values under specific conditions, creating a reflected XSS vector in any view that passes unsanitized user input through the affected helpers (e.g., `tag`, `content_tag`).  
Fix type: Direct upgrade. After upgrading, audit view templates that pass raw user input to tag helpers and confirm they use `html_escape` or equivalent.

---

**B1c. activestorage 8.1.2 — four CVEs**

| CVE | GHSA | Title | Class |
|---|---|---|---|
| CVE-2026-33173 | GHSA-qcfx-2mfw-w4cg | Content-type bypass via metadata in direct uploads | Auth bypass |
| CVE-2026-33174 | GHSA-r46p-8f7g-vvvg | DoS via Range requests in proxy mode | DoS |
| CVE-2026-33195 | GHSA-9xrj-h377-fr87 | Path Traversal in DiskService | Path Traversal |
| CVE-2026-33202 | GHSA-73f9-jhhh-hr5m | Glob injection in DiskService | Injection |

Severity: Unknown (treat as High — Path Traversal and Glob Injection are critical in file-serving contexts)

Explanation:
- **Content-type bypass** (CVE-2026-33173): An attacker can manipulate file metadata during a direct upload to misrepresent the MIME type, potentially bypassing content-type allow-lists and serving malicious files as trusted types.
- **Range request DoS** (CVE-2026-33174): In proxy mode, a specially crafted `Range` header causes excessive memory or CPU consumption, enabling denial of service.
- **Path Traversal** (CVE-2026-33195): DiskService does not sufficiently sanitize blob keys, allowing a traversal sequence to read or overwrite files outside the storage root.
- **Glob Injection** (CVE-2026-33202): DiskService passes user-controlled data into a glob pattern without escaping, enabling an attacker to enumerate or manipulate unintended filesystem paths.

Fix type: Direct upgrade. If you use `DiskService` in production, treat this as **Critical**. If using S3/GCS/Azure, the DiskService CVEs are lower risk but the upgrade is still mandatory for the content-type and DoS issues.

---

**B1d. activesupport 8.1.2 — three CVEs**

| CVE | GHSA | Title | Class |
|---|---|---|---|
| CVE-2026-33169 | GHSA-cg4j-q9v8-6v38 | ReDoS in `number_to_delimited` | ReDoS |
| CVE-2026-33170 | GHSA-89vf-4333-qx8v | XSS in `SafeBuffer#%` | XSS |
| CVE-2026-33176 | GHSA-2j26-frm8-cmj9 | DoS in number helpers | DoS |

Severity: Unknown (treat as High)

Explanation:
- **ReDoS / DoS** (CVE-2026-33169, CVE-2026-33176): Regex patterns inside `number_to_delimited` and related number formatting helpers exhibit catastrophic backtracking when given adversarially crafted input strings, causing request threads to hang.
- **XSS in SafeBuffer#%** (CVE-2026-33170): The `%` string interpolation operator on `ActiveSupport::SafeBuffer` does not re-mark the result as safe only when all interpolated values are already safe, creating an XSS path in views that use `%`-style interpolation on safe strings.

Fix type: Direct upgrade. Review any view code using `SafeBuffer#%` interpolation.

---

### B2. addressable 2.8.9

CVE: `CVE-2026-35611` · GHSA: `GHSA-h27x-rffw-24p4`  
Severity: **High**  
Required: >= 2.9.0  
Title: Regular Expression Denial of Service (ReDoS) in URI template parsing  
Explanation: The URI template parser uses a regex that exhibits catastrophic backtracking on specially crafted template strings. Any code path that calls `Addressable::Template.new` with user-controlled input (e.g., in webhook URL handling, OAuth redirect URIs, or API client routing) is vulnerable to request-thread exhaustion.  
Fix type: Direct upgrade. Check whether 2.9.0 introduces any breaking changes to the template API if you construct templates programmatically.

---

### B3. nokogiri 1.19.1

**GHSA-c4rq-3m3g-8wgx** — Severity: **High**  
Title: CSS selector tokenizer has regular expression backtracking (ReDoS)  
Required: >= 1.19.3  
Explanation: The CSS selector tokenizer uses a regex susceptible to catastrophic backtracking. Any code path that calls `Nokogiri::CSS.parse` or uses CSS selectors on untrusted HTML (e.g., parsing user-submitted content) is vulnerable.

**GHSA-v2fc-qm4h-8hqv** — Severity: **Medium**  
Title: XSLT transform memory leak  
Required: >= 1.19.3  
Explanation: Repeated XSLT transformations (via `Nokogiri::XSLT`) leak memory in the underlying libxslt bindings, eventually causing OOM conditions in long-running processes. Most impactful in background jobs or request handlers that repeatedly transform XML.

Fix type: Direct upgrade (patch-level). Native extension will be recompiled; no API changes between 1.19.1 and 1.19.3.

---

### B4. rack 3.2.5 — eleven CVEs

All fixed by upgrading to >= 3.2.6. Grouped by severity:

**High:**

| CVE | GHSA | Title |
|---|---|---|
| CVE-2026-34785 | GHSA-h2jq-g4cq-5ppq | `Rack::Static` prefix matching exposes unintended files under static root |
| CVE-2026-34827 | GHSA-v6x5-cg8r-vv6x | Multipart header parsing DoS via escape-heavy quoted parameters |
| CVE-2026-34829 | GHSA-8vqr-qjwx-82mw | Unbounded chunked file uploads without Content-Length header |

**Medium:**

| CVE | GHSA | Title |
|---|---|---|
| CVE-2026-26962 | GHSA-rx22-g9mx-qrhv | Folded multipart header CRLF preserved in parsed parameter values |
| CVE-2026-32762 | GHSA-qfgr-crr9-7r49 | Forwarded header semicolon injection → Host/Scheme spoofing |
| CVE-2026-34230 | GHSA-v569-hp3g-36wr | Quadratic complexity in `select_best_encoding` via wildcard `Accept-Encoding` |
| CVE-2026-34763 | GHSA-7mqq-6cf9-v2qp | Root directory disclosure via unescaped regex in `Rack::Directory` |
| CVE-2026-34786 | GHSA-q4qf-9j86-f5mh | `Rack::Static` `header_rules` bypass via URL-encoded paths |
| CVE-2026-34826 | GHSA-x8cg-fq8g-mxfx | DoS via excessive overlapping byte ranges in multipart processing |
| CVE-2026-34830 | GHSA-qv7j-4883-hwh7 | `Rack::Sendfile` regex injection enabling unauthorized `X-Accel-Redirect` |
| CVE-2026-34831 | GHSA-q2ww-5357-x388 | Content-Length mismatch in `Rack::Files` error responses |
| CVE-2026-34835 | GHSA-g2pf-xv49-m2h5 | Invalid Host characters accepted, enabling host allowlist bypass |

**Low:**

| CVE | GHSA | Title |
|---|---|---|
| CVE-2026-26961 | GHSA-vgpv-f759-9wx3 | Greedy multipart boundary parsing → parser differentials / WAF bypass |

Fix type: Direct upgrade (patch-level 3.2.5 → 3.2.6). No breaking API changes expected within the 3.2.x series.

---

### B5. rack-session 2.1.1

CVE: `CVE-2026-39324` · GHSA: `GHSA-33qg-7wpp-89cq`  
Severity: Unknown (treat as **Critical**)  
Required: >= 2.1.2  
Title: Cookie session secret decryption failure falls back to secretless session, enabling forgery and Marshal deserialization  
Explanation: When cookie session decryption fails (e.g., due to a key rotation or malformed cookie), `Rack::Session::Cookie` silently falls back to accepting an unsigned/unencrypted session. An attacker can craft a malicious `Marshal`-serialized session cookie and have it deserialized by the server, leading to **Remote Code Execution** via Ruby object deserialization. This is the most severe vulnerability in this audit.  
Fix type: Direct upgrade. After upgrading, rotate your `secret_key_base` and invalidate existing sessions (sign users out). Verify `config.session_store` is set correctly and confirm there is no fallback-secret configuration in initializers.

---

## C. Exact Upgrade Instructions

### Step 1 — Gemfile changes

These gems are typically pulled in transitively (via `rails`, `rack`, etc.) and may not appear directly in your `Gemfile`. Add explicit version pins only if the transitive upgrade does not satisfy the requirements automatically (check after running the commands in Section D).

If you need to force a minimum version, add or update these lines:

```ruby
# Gemfile

# Explicit floor pins — add only if `bundle update` below does not resolve automatically
gem "rails", ">= 8.1.2.1"        # covers actionpack, actionview, activestorage, activesupport
gem "addressable", ">= 2.9.0"
gem "nokogiri", ">= 1.19.3"
gem "rack", ">= 3.2.6"
gem "rack-session", ">= 2.1.2"
```

> If your Gemfile already pins `gem "rails", "~> 8.1.0"`, change it to `"~> 8.1.2", ">= 8.1.2.1"` or simply `">= 8.1.2.1"`.

### Step 2 — Gemfile.lock

Do **not** edit `Gemfile.lock` manually. It will be regenerated by the commands in Section D. After running those commands, commit the updated lock file.

---

## D. Commands to Run

Run these in order. Each command is targeted to minimize the blast radius — only the specified gems and their dependencies are updated.

```bash
# 1. Update all Rails framework gems together (they must move in lockstep)
bundle update rails

# 2. Update addressable independently
bundle update addressable

# 3. Update nokogiri (recompiles native extension — may take ~30s)
bundle update nokogiri

# 4. Update rack and rack-session together (rack-session depends on rack)
bundle update rack rack-session

# 5. Re-run the audit to confirm all advisories are cleared
bundle exec bundler-audit check --update

# 6. Run your test suite
bundle exec rspec            # or: bundle exec rails test
```

If any of the targeted updates cause a dependency conflict (bundler reports "could not find compatible versions"), fall back to:

```bash
# Nuclear option — updates everything. Review the diff carefully before committing.
bundle update
```

After all updates:

```bash
# Rotate secret_key_base (critical for rack-session CVE)
# Generate a new value and update your credentials / environment variable:
bundle exec rails secret

# Then update config/credentials.yml.enc or your secrets manager with the new value.
# This invalidates all existing sessions — users will be signed out.
```

---

## E. Regressions, Breaking Changes, and Required Testing

### rack-session (HIGH RISK)

Rotating `secret_key_base` after the upgrade will **sign all users out**. Plan a maintenance window or a graceful key-rotation strategy (keep the old secret as a fallback for one deploy cycle, then remove it) if session continuity matters.

### Rails 8.1.2.1 (LOW RISK)

This is a security patch release within the 8.1 series. Patch releases are not supposed to introduce breaking changes, but verify:
- Any view templates using `SafeBuffer#%`-style interpolation render correctly after the upgrade.
- Tag helpers that pass user-controlled data still escape correctly (write a request spec asserting XSS strings are escaped).
- If you use `DiskService`, run file upload/download integration tests end-to-end.
- If you use `number_to_delimited` or other number formatters in views or mailers, spot-check their output.

### rack 3.2.6 (LOW RISK)

Patch-level bump within 3.2.x. Likely safe, but test:
- Any middleware that reads the `Forwarded` or `X-Forwarded-*` headers (the semicolon injection fix may change parsing behaviour).
- Static file serving (`Rack::Static`) — verify that only intended paths are reachable after the fix tightens prefix matching.
- Multipart form submissions with large or unusual files.
- Any custom `Rack::Sendfile` configuration.

### addressable 2.9.0 (MODERATE RISK)

The jump from 2.8.x to 2.9.0 is a minor version bump and may include behaviour changes to template expansion. Check:
- Any code using `Addressable::Template` for URI construction or matching.
- OAuth redirect URI matching if you use addressable for validation.
- Review the [2.9.0 changelog](https://github.com/sporkmonger/addressable/blob/main/CHANGELOG.md) before deploying.

### nokogiri 1.19.3 (LOW RISK)

Patch-level bump. Recompiles the native C extension. Test:
- HTML/XML parsing in any controller, job, or service object.
- CSS selector queries on user-supplied HTML (this is exactly the vector that was patched).
- XSLT transforms if used.

### Transitive dependency note

`rack` is a dependency of `actionpack`, `actiondispatch`, `railties`, and several other gems. Running `bundle update rack rack-session` may pull in a newer `rack` than the one Rails 8.1.2.1 was tested against. If bundler resolves a rack version that Rails does not officially support, run `bundle update rails rack rack-session` as a single command instead, so bundler can find a consistent resolution across all three.

---

## Quick Reference — Priority Order

| Priority | Gem(s) | Action | Why |
|---|---|---|---|
| **Critical** | rack-session | `bundle update rack rack-session` + rotate `secret_key_base` | RCE via Marshal deserialization |
| **Critical** | activestorage (DiskService) | `bundle update rails` | Path traversal + glob injection |
| **High** | rack | included above | File exposure, unbounded uploads, DoS |
| **High** | addressable | `bundle update addressable` | ReDoS on user-controlled URLs |
| **High** | nokogiri | `bundle update nokogiri` | ReDoS on user-supplied HTML |
| **High** | actionpack, actionview | included in `bundle update rails` | XSS |
| **High** | activesupport | included in `bundle update rails` | ReDoS, XSS, DoS |
| **Medium** | nokogiri (memory leak) | included above | OOM in long-running processes |
| **Medium** | rack (remaining CVEs) | included above | Various injection / bypass issues |
| **Low** | rack (WAF bypass) | included above | Parser differential |
