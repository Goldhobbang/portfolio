import {
  REPOS_URL,
  displayBlurb,
  hostLabel,
  htmlTitle,
  isRateLimitedResponse,
  looksLikeGithubPagesMiss,
  looksLikeHtml,
  mergeCandidates,
  nextLink,
  probeDocument,
  publishedEntryUrls,
  readFrameState,
  slimRepo,
} from "./catalog.js";

const CACHE_KEY = "goldhobbang-transit-v1";
const FRESH_MS = 10 * 60 * 1000;
const API_HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

const grid = document.getElementById("hub-grid");
const statusEl = document.getElementById("hub-status");
const countEl = document.getElementById("hub-count");
const refreshBtn = document.getElementById("hub-refresh");
const yearEl = document.getElementById("year");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

if (yearEl) yearEl.textContent = String(new Date().getFullYear());

refreshBtn?.addEventListener("click", () => {
  loadHub({ bypassCache: true });
});

if (!reducedMotion && "IntersectionObserver" in window) {
  document.documentElement.classList.add("motion-on");
}
addEventListener("resize", fitPreviews);

loadHub({ bypassCache: false });

async function loadHub({ bypassCache }) {
  setBusy(true);
  setStatus("공개 저장소를 확인하는 중", "loading");
  if (countEl) countEl.textContent = "SCAN";
  grid.replaceChildren();
  grid.append(...skeletonCards(4));

  const cache = readCache();
  if (!bypassCache && cache && Date.now() - cache.at < FRESH_MS) {
    renderSites(cache.sites, { source: "cache" });
    return;
  }

  try {
    const repos = await fetchRepos();
    const manifestSites = await fetchManifest();
    const candidates = mergeCandidates(repos, manifestSites, window.location);
    setStatus(`${candidates.length}개 주소가 응답하는지 확인하는 중`, "loading");
    const sites = await verifyAll(candidates);
    writeCache({ at: Date.now(), sites });
    renderSites(sites, { source: "live" });
  } catch (error) {
    if (cache?.sites?.length) {
      renderSites(cache.sites, { source: "stale", error });
      return;
    }
    renderFailure(error);
  }
}

async function fetchRepos() {
  const repos = [];
  let url = REPOS_URL;
  for (let page = 0; page < 10 && url; page += 1) {
    const response = await fetch(url, { headers: API_HEADERS });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(isRateLimited(response, text) ? "rate" : "api");
      error.rateLimited = isRateLimited(response, text);
      throw error;
    }
    const batch = JSON.parse(text);
    if (!Array.isArray(batch)) throw new Error("api");
    repos.push(...batch.map(slimRepo));
    if (batch.length < 100) {
      url = null;
    } else {
      const linked = nextLink(response.headers.get("Link"));
      if (linked) {
        url = linked;
      } else {
        const next = new URL(url);
        next.searchParams.set("page", String(Number(next.searchParams.get("page") || "1") + 1));
        url = next.toString();
      }
    }
  }
  return repos;
}

function isRateLimited(response, text) {
  return isRateLimitedResponse(response.status, response.headers.get("X-RateLimit-Remaining"), text);
}

async function fetchManifest() {
  try {
    const response = await fetch(new URL("../../data/pages-manifest.json", import.meta.url), { cache: "no-store" });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data?.sites) ? data.sites : [];
  } catch {
    return [];
  }
}

async function verifyAll(candidates) {
  const sites = new Array(candidates.length);
  let cursor = 0;
  async function worker() {
    while (cursor < candidates.length) {
      const index = cursor;
      cursor += 1;
      const site = await verifyCandidate(candidates[index]);
      if (site) sites[index] = site;
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, () => worker()));
  return sites.filter(Boolean);
}

async function verifyCandidate(candidate) {
  const direct = await probeDocument(candidate.url, { here: window.location });
  if (direct.verdict === "dead") return null;
  if (direct.verdict === "live") {
    if (isOwnDocument(direct.finalUrl)) return null;
    return {
      ...candidate,
      finalUrl: direct.finalUrl,
      title: direct.title || "",
      frameBlocked: direct.frameBlocked === true,
    };
  }
  const fallback = await probeWhenCorsBlocked(candidate);
  if (!fallback) return null;
  return { ...candidate, finalUrl: fallback.finalUrl, title: fallback.title || candidate.title || "" };
}

function isOwnDocument(url) {
  try {
    const next = new URL(url, window.location.href);
    const here = new URL(window.location.href);
    return next.origin === here.origin && (next.pathname === here.pathname || next.pathname === "/" || next.pathname.endsWith("/index.html") || next.pathname.endsWith("/hub.html"));
  } catch {
    return false;
  }
}

async function probeWhenCorsBlocked(candidate) {
  // 공개 API의 has_pages 만으로는 404 페이지를 걸러낼 수 없다.
  // CORS가 막히면 GitHub 기본 404(ACA O 없음)와 헤더를 닫아 둔 실제 사이트가 같다.
  // 호스트가 응답하고, 배포 브랜치에 HTML 입구가 있을 때만 남긴다.
  try {
    const opaque = await fetch(candidate.url, { mode: "no-cors", cache: "no-store" });
    if (opaque.type !== "opaque" && opaque.type !== "basic") return null;
  } catch {
    return null;
  }
  for (const entryUrl of publishedEntryUrls(candidate)) {
    try {
      const response = await fetch(entryUrl, { cache: "no-store" });
      if (!response.ok) continue;
      const text = await response.text();
      const type = response.headers.get("content-type") || "";
      if (looksLikeGithubPagesMiss(text, response.status) || !looksLikeHtml(text, type)) continue;
      return { finalUrl: candidate.url, title: htmlTitle(text) };
    } catch {
      /* 다음 입구 */
    }
  }
  return null;
}

function renderSites(sites, { source, error }) {
  setBusy(false);
  grid.replaceChildren();
  if (!sites.length) {
    if (countEl) countEl.textContent = "0 LIVE";
    setStatus("응답하는 GitHub Pages가 없습니다.", "empty");
    grid.append(emptyNote());
    return;
  }
  if (countEl) countEl.textContent = `${String(sites.length).padStart(2, "0")} LIVE`;
  if (source === "stale") {
    const why = error?.rateLimited ? "호출 한도" : "연결 오류";
    setStatus(`GitHub API ${why}로 이 탭에 남아 있는 목록을 보여 줍니다.`, "stale");
  } else if (source === "cache") {
    setStatus(`${sites.length}개의 페이지. 이 탭에서 조금 전에 확인한 목록입니다.`, "cache");
  } else {
    setStatus(`${sites.length}개의 페이지가 실제로 열립니다.`, "live");
  }
  statusEl.dataset.source = source;
  const cards = sites.map((site, index) => createCard(site, index));
  grid.append(...cards);
  fitPreviews();
  requestAnimationFrame(fitPreviews);
  watchPreviews(cards);
}

function renderFailure(error) {
  setBusy(false);
  grid.replaceChildren();
  if (countEl) countEl.textContent = "HOLD";
  const rate = Boolean(error?.rateLimited);
  setStatus(rate ? "GitHub API 호출 한도에 닿았습니다." : "저장소 목록을 가져오지 못했습니다.", "error");
  const note = document.createElement("div");
  note.className = "hub-note";
  const title = document.createElement("strong");
  title.textContent = rate ? "잠시 뒤 다시 확인하면 됩니다." : "목록 요청이 끝나지 않았습니다.";
  const copy = document.createElement("p");
  copy.textContent = "토큰 없이 공개 API만 사용합니다. 네트워크가 돌아오면 다시 확인을 눌러 주세요.";
  note.append(title, copy);
  grid.append(note);
}

function createCard(site, index) {
  const article = document.createElement("article");
  article.className = "site-card";
  article.dataset.site = site.name;
  article.style.setProperty("--d", `${(index % 4) * 70}ms`);

  const head = document.createElement("div");
  head.className = "site-head";
  const number = document.createElement("span");
  number.className = "site-no";
  number.textContent = String(index + 1).padStart(2, "0");
  const titles = document.createElement("div");
  titles.className = "site-titles";
  const heading = document.createElement("h2");
  heading.textContent = site.name;
  const blurb = document.createElement("p");
  blurb.textContent = displayBlurb(site);
  titles.append(heading, blurb);
  const lang = document.createElement("span");
  lang.className = "meta site-lang";
  lang.textContent = site.language || "PAGE";
  head.append(number, titles, lang);

  const viewport = document.createElement("div");
  viewport.className = "viewport is-loading";
  const frame = document.createElement("iframe");
  frame.title = `${site.name} 미리보기`;
  frame.loading = "lazy";
  frame.referrerPolicy = "strict-origin-when-cross-origin";
  frame.setAttribute("sandbox", "allow-scripts allow-forms allow-popups");
  frame.dataset.src = site.frameBlocked ? "" : (site.finalUrl || site.url);
  frame.addEventListener("load", () => {
    if (!frame.src) return;
    onFrameLoad(viewport, frame);
  });
  frame.addEventListener("error", () => showBlocked(viewport));
  const fallback = document.createElement("div");
  fallback.className = "viewport-fallback";
  fallback.hidden = true;
  const kicker = document.createElement("span");
  kicker.className = "meta";
  kicker.textContent = "PREVIEW";
  const fallbackTitle = document.createElement("strong");
  fallbackTitle.textContent = "이 창에는 담기지 않습니다.";
  const fallbackCopy = document.createElement("p");
  fallbackCopy.textContent = "사이트는 열려 있습니다. 아래 링크로 바로 이동할 수 있습니다.";
  fallback.append(kicker, fallbackTitle, fallbackCopy);
  viewport.append(frame, fallback);
  if (site.frameBlocked) showBlocked(viewport);

  const foot = document.createElement("div");
  foot.className = "site-foot";
  const urlLink = document.createElement("a");
  urlLink.className = "site-url";
  urlLink.href = site.finalUrl || site.url;
  urlLink.target = "_blank";
  urlLink.rel = "noopener noreferrer";
  urlLink.textContent = hostLabel(site.finalUrl || site.url);
  const open = document.createElement("a");
  open.className = "inline-link";
  open.href = site.finalUrl || site.url;
  open.target = "_blank";
  open.rel = "noopener noreferrer";
  open.textContent = "OPEN ↗";
  const repo = document.createElement("a");
  repo.className = "site-repo";
  repo.href = site.repoUrl;
  repo.target = "_blank";
  repo.rel = "noopener noreferrer";
  repo.textContent = "REPO ↗";
  foot.append(urlLink, open, repo);

  article.append(head, viewport, foot);
  return article;
}

function onFrameLoad(viewport, frame) {
  viewport.classList.remove("is-loading");
  const state = readFrameState(frame.contentWindow);
  if (state === "blocked") showBlocked(viewport);
}

function showBlocked(viewport) {
  viewport.classList.remove("is-loading");
  viewport.classList.add("is-blocked");
  const fallback = viewport.querySelector(".viewport-fallback");
  if (fallback) fallback.hidden = false;
  const frame = viewport.querySelector("iframe");
  if (frame) frame.tabIndex = -1;
}

function fitPreviews() {
  for (const viewport of grid.querySelectorAll(".viewport")) {
    const width = viewport.clientWidth;
    if (width > 0) viewport.style.setProperty("--fit", String(width / 1440));
  }
}

function watchPreviews(cards) {
  const frames = cards.map((card) => card.querySelector("iframe")).filter(Boolean);
  const arm = (frame) => {
    if (!frame.dataset.src || frame.src) return;
    frame.src = frame.dataset.src;
  };
  frames.slice(0, 2).forEach(arm);
  if (!("IntersectionObserver" in window)) {
    frames.forEach(arm);
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      arm(entry.target);
      observer.unobserve(entry.target);
    }
  }, { rootMargin: "240px 0px" });
  frames.forEach((frame) => observer.observe(frame));
}

function skeletonCards(count) {
  return Array.from({ length: count }, () => {
    const card = document.createElement("div");
    card.className = "site-card is-skeleton";
    card.setAttribute("aria-hidden", "true");
    card.innerHTML = '<div class="site-head"><span class="site-no">··</span><div class="site-titles"><h2></h2><p></p></div></div><div class="viewport is-loading"></div>';
    return card;
  });
}

function emptyNote() {
  const note = document.createElement("div");
  note.className = "hub-note";
  const title = document.createElement("strong");
  title.textContent = "열린 페이지가 없습니다.";
  const copy = document.createElement("p");
  copy.textContent = "공개 저장소 가운데 GitHub Pages로 응답하는 주소가 없습니다. 저장소만 있는 프로젝트는 여기에 올리지 않습니다.";
  note.append(title, copy);
  return note;
}

function setStatus(text, state) {
  statusEl.textContent = text;
  statusEl.dataset.state = state;
}

function setBusy(busy) {
  grid.setAttribute("aria-busy", busy ? "true" : "false");
  if (refreshBtn) refreshBtn.disabled = busy;
}

function readCache() {
  try {
    const data = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null");
    if (!data || !Array.isArray(data.sites) || typeof data.at !== "number") return null;
    return data;
  } catch {
    return null;
  }
}

function writeCache(data) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {
    /* private mode or a full quota still leaves the page usable */
  }
}
