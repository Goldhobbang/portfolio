// 비공개 저장소의 Pages는 토큰 없는 공개 API로 보이지 않습니다.
// 토큰을 프론트엔드에 넣지 마세요. 나중에 포함하려면 GitHub Action이
// data/pages-manifest.json 의 sites 배열을 갱신하는 방식이 안전합니다.

export const OWNER = "Goldhobbang";
export const REPOS_URL = `https://api.github.com/users/${OWNER}/repos?per_page=100`;
export const SELF_REPOS = new Set(["portfolio"]);

const GITHUB_MISS = "There isn't a GitHub Pages site here.";

export function cleanDescription(value) {
  return String(value || "")
    .replace(/^\s*#+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function htmlTitle(text) {
  const match = String(text || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return "";
  return decodeEntities(match[1].replace(/\s+/g, " ").trim());
}

export function decodeEntities(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(Number(dec)))
    .replace(/&middot;/gi, "·")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function safeCodePoint(code) {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

export function looksLikeHtml(text, contentType = "") {
  const head = String(text || "").slice(0, 4000).trim();
  if (/<!doctype\s+html|<html[\s>]/i.test(head)) return true;
  return /html|xml/i.test(contentType || "") && head.startsWith("<");
}

export function looksLikeGithubPagesMiss(text, status) {
  if (status === 404 || status === 410) return true;
  const sample = String(text || "").slice(0, 12000);
  if (sample.includes(GITHUB_MISS)) return true;
  return /<title>[^<]*Site not found[^<]*GitHub Pages[^<]*<\/title>/i.test(sample);
}

export function nextLink(header) {
  if (!header) return null;
  for (const part of String(header).split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="?next"?/i);
    if (match) return match[1];
  }
  return null;
}

export function pagesUrlForRepo(repo) {
  const home = String(repo?.homepage || "").trim();
  const fromHome = home ? asPagesUrl(home) : null;
  if (fromHome) return normalizeUrl(fromHome);
  return normalizeUrl(`https://${OWNER.toLowerCase()}.github.io/${encodeURIComponent(repo.name)}/`);
}

export function asPagesUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url;
  try {
    url = new URL(withProtocol);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  const pagesHost = host.endsWith(".github.io") || host === "goldhobbang.dev" || host === "www.goldhobbang.dev" || host.endsWith(".goldhobbang.dev");
  if (!pagesHost) return null;
  if (url.protocol === "http:") url.protocol = "https:";
  return url.toString();
}

export function normalizeUrl(value) {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  url.hostname = url.hostname.toLowerCase();
  if (url.protocol === "http:") url.protocol = "https:";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.toString();
}

export function isSelfRepo(name) {
  return SELF_REPOS.has(String(name || "").trim().toLowerCase());
}

export function isSelfUrl(value, here = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (host === "goldhobbang.dev" || host === "www.goldhobbang.dev") return true;
  if (host === "goldhobbang.github.io" && path.toLowerCase() === "/portfolio") return true;
  if (here.href) {
    try {
      const current = new URL(here.href);
      const currentHost = current.hostname.toLowerCase();
      const currentPath = current.pathname.replace(/\/+$/, "") || "/";
      const sameDocument = host === currentHost && (path === currentPath || path === "/" || path === "/index.html" || path === "/hub.html" || path === "/abyss.html");
      if (sameDocument) return true;
    } catch {
      /* ignore malformed location */
    }
  }
  return false;
}

export function slimRepo(repo) {
  return {
    name: repo.name,
    description: repo.description || "",
    homepage: repo.homepage || "",
    html_url: repo.html_url,
    language: repo.language || "",
    pushed_at: repo.pushed_at || repo.updated_at || "",
    default_branch: repo.default_branch || "main",
    has_pages: repo.has_pages === true,
  };
}

export function mergeCandidates(repos, manifestSites, here) {
  const list = [];
  const seen = new Set();
  const add = (entry) => {
    if (!entry?.name || !entry.url) return;
    if (isSelfRepo(entry.name) || isSelfUrl(entry.url, here)) return;
    let key;
    try {
      key = normalizeUrl(entry.url);
    } catch {
      return;
    }
    if (seen.has(key)) return;
    seen.add(key);
    list.push({ ...entry, url: key });
  };

  for (const repo of repos || []) {
    if (!repo || repo.has_pages !== true || !repo.name) continue;
    add({
      name: repo.name,
      description: cleanDescription(repo.description),
      url: pagesUrlForRepo(repo),
      repoUrl: repo.html_url || `https://github.com/${OWNER}/${repo.name}`,
      language: repo.language || "",
      pushedAt: repo.pushed_at || repo.updated_at || "",
      defaultBranch: repo.default_branch || "main",
      source: "api",
    });
  }

  for (const extra of manifestSites || []) {
    if (!extra || typeof extra !== "object") continue;
    const name = String(extra.name || "").trim();
    if (!name) continue;
    const explicit = extra.url ? asPagesUrl(extra.url) || (isHttpUrl(extra.url) ? extra.url : null) : null;
    const url = explicit || pagesUrlForRepo({ name, homepage: "" });
    add({
      name,
      description: cleanDescription(extra.description),
      url,
      repoUrl: isHttpUrl(extra.repoUrl) ? extra.repoUrl : `https://github.com/${OWNER}/${name}`,
      language: extra.language || "",
      pushedAt: extra.pushedAt || "",
      defaultBranch: extra.defaultBranch || extra.branch || "main",
      source: "manifest",
    });
  }

  list.sort((a, b) => {
    const aTime = Date.parse(a.pushedAt) || 0;
    const bTime = Date.parse(b.pushedAt) || 0;
    if (aTime !== bTime) return bTime - aTime;
    return a.name.localeCompare(b.name);
  });
  return list;
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function frameBlockedByPolicy(headers) {
  const read = (name) => {
    if (!headers || typeof headers.get !== "function") return "";
    return String(headers.get(name) || "");
  };
  const xfo = read("x-frame-options").toLowerCase();
  if (/\bdeny\b/.test(xfo) || xfo.includes("sameorigin")) return true;
  return /frame-ancestors\s+(?:'none'|'self')(?:\s|;|$)/i.test(read("content-security-policy"));
}

export function readFrameState(view) {
  try {
    const href = view.location.href;
    if (!href || href === "about:blank") return "blocked";
    return "open";
  } catch (error) {
    return error && error.name === "SecurityError" ? "embedded" : "blocked";
  }
}

export function publishedEntryUrls(candidate) {
  const branches = [];
  for (const branch of [candidate?.defaultBranch, "main", "gh-pages"]) {
    if (branch && !branches.includes(branch)) branches.push(branch);
  }
  const paths = ["index.html", "index.htm", "docs/index.html"];
  const urls = [];
  for (const branch of branches) {
    for (const path of paths) {
      const segments = path.split("/").map((part) => encodeURIComponent(part)).join("/");
      urls.push(`https://raw.githubusercontent.com/${OWNER}/${encodeURIComponent(candidate.name)}/${encodeURIComponent(branch)}/${segments}`);
    }
  }
  return urls;
}

const PROBE_MS = 8000;

export async function probeDocument(url, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const here = options.here || {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || PROBE_MS);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    const finalUrl = response.url || url;
    if (isSelfUrl(finalUrl, here)) return { verdict: "dead", reason: "self" };
    const text = await response.text();
    if (!response.ok || looksLikeGithubPagesMiss(text, response.status)) {
      return { verdict: "dead", reason: "status" };
    }
    const type = typeof response.headers?.get === "function" ? response.headers.get("content-type") || "" : "";
    if (!looksLikeHtml(text, type)) return { verdict: "dead", reason: "not-html" };
    return { verdict: "live", finalUrl, title: htmlTitle(text), frameBlocked: frameBlockedByPolicy(response.headers) };
  } catch (error) {
    if (error && error.name === "AbortError") return { verdict: "dead", reason: "timeout" };
    return { verdict: "blocked", reason: "cors" };
  } finally {
    clearTimeout(timer);
  }
}

export function displayBlurb(site) {
  const description = cleanDescription(site.description);
  const title = cleanDescription(site.title);
  if (description) return description;
  if (title && title.toLowerCase() !== String(site.name || "").toLowerCase()) return title;
  return "공개된 GitHub Pages 사이트";
}

export function isRateLimitedResponse(status, remaining, body) {
  if (status === 429) return true;
  if (status !== 403) return false;
  if (remaining === "0") return true;
  return /rate limit/i.test(String(body || ""));
}

export function hostLabel(value) {
  try {
    const url = new URL(value);
    const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
    return `${url.hostname}${path}`;
  } catch {
    return value;
  }
}
