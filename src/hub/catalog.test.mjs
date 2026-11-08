import test from "node:test";
import assert from "node:assert/strict";

function responseOf(status, body, url) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: { get: (name) => (name.toLowerCase() === "content-type" ? "text/html" : null) },
    text: async () => body,
  };
}
import {
  asPagesUrl,
  cleanDescription,
  displayBlurb,
  htmlTitle,
  isHiddenRepo,
  isSelfRepo,
  isSelfUrl,
  looksLikeGithubPagesMiss,
  looksLikeHtml,
  mergeCandidates,
  nextLink,
  pagesUrlForRepo,
  frameBlockedByPolicy,
  probeDocument,
  publishedEntryUrls,
  readFrameState,
} from "./catalog.js";

test("homepage is used only when it is clearly a Pages URL", () => {
  assert.equal(
    pagesUrlForRepo({ name: "DiagramPreview", homepage: "https://goldhobbang.github.io/DiagramPreview/" }),
    "https://goldhobbang.github.io/DiagramPreview/",
  );
  assert.equal(
    pagesUrlForRepo({ name: "omniSearch", homepage: "" }),
    "https://goldhobbang.github.io/omniSearch/",
  );
  assert.equal(
    pagesUrlForRepo({ name: "is-a-dev", homepage: "https://is-a.dev" }),
    "https://goldhobbang.github.io/is-a-dev/",
  );
  assert.equal(asPagesUrl("goldhobbang.dev/hub.html"), "https://goldhobbang.dev/hub.html");
  assert.equal(asPagesUrl("not a url"), null);
});

test("this portfolio is excluded by repo name and by its public URLs", () => {
  assert.equal(isSelfRepo("portfolio"), true);
  assert.equal(isSelfRepo("Portfolio"), true);
  assert.equal(isSelfRepo("omniSearch"), false);
  assert.equal(isHiddenRepo("yougay"), true);
  assert.equal(isHiddenRepo("YouGay"), true);
  assert.equal(isHiddenRepo("omniSearch"), false);
  assert.equal(isSelfUrl("https://goldhobbang.dev/"), true);
  assert.equal(isSelfUrl("https://goldhobbang.dev/hub.html"), true);
  assert.equal(isSelfUrl("https://goldhobbang.github.io/portfolio"), true);
  assert.equal(isSelfUrl("https://goldhobbang.github.io/omniSearch/"), false);
  assert.equal(
    isSelfUrl("https://127.0.0.1/hub.html", { href: "http://127.0.0.1:8765/hub.html" }),
    true,
  );
});

test("GitHub Pages 404 documents are rejected and real documents pass", () => {
  const miss = "<title>Site not found · GitHub Pages</title><p>There isn't a GitHub Pages site here.</p>";
  assert.equal(looksLikeGithubPagesMiss(miss, 200), true);
  assert.equal(looksLikeGithubPagesMiss("<title>omniSearch</title><p>ok</p>", 404), true);
  assert.equal(looksLikeGithubPagesMiss("<!doctype html><title>omniSearch</title>", 200), false);
  assert.equal(looksLikeHtml("<!doctype html><html>", "text/plain"), true);
  assert.equal(looksLikeHtml("not html", "text/plain"), false);
  assert.equal(htmlTitle("<title>마음결 &middot; 시연</title>"), "마음결 · 시연");
});

test("manifest entries merge without duplicating or replacing the live API result", () => {
  const repos = [
    {
      name: "omniSearch",
      has_pages: true,
      homepage: "",
      description: "API키 없이",
      html_url: "https://github.com/Goldhobbang/omniSearch",
      language: "Python",
      pushed_at: "2026-01-02T00:00:00Z",
      default_branch: "main",
    },
    { name: "portfolio", has_pages: true, homepage: null, description: "self" },
    { name: "yougay", has_pages: true, homepage: null, description: "hidden" },
    { name: "pyasynckit", has_pages: false, homepage: null },
  ];
  const manifest = [
    { name: "omniSearch", url: "https://goldhobbang.github.io/omniSearch/", description: "duplicate" },
    { name: "playground", url: "https://goldhobbang.github.io/playground/", description: "연습" },
    { name: "portfolio", url: "https://goldhobbang.dev/" },
    { name: "yougay", url: "https://goldhobbang.github.io/yougay/" },
  ];
  const sites = mergeCandidates(repos, manifest);
  assert.deepEqual(sites.map((site) => site.name), ["omniSearch", "playground"]);
  assert.equal(sites[0].source, "api");
  assert.equal(sites[0].description, "API키 없이");
  assert.equal(sites[1].source, "manifest");
});

test("descriptions lose a leading markdown heading", () => {
  assert.equal(cleanDescription("# 고전시가 연습"), "고전시가 연습");
  assert.equal(displayBlurb({ name: "PoomSa", description: "", title: "PoomSa — 문장" }), "PoomSa — 문장");
  assert.equal(displayBlurb({ name: "PoomSa", description: "", title: "PoomSa" }), "공개된 GitHub Pages 사이트");
});

test("a direct document probe keeps live HTML and drops Pages 404s", async () => {
  const live = await probeDocument("https://goldhobbang.github.io/omniSearch/", {
    fetchImpl: async () => responseOf(200, "<!doctype html><title>omniSearch</title>", "https://goldhobbang.github.io/omniSearch/"),
  });
  assert.equal(live.verdict, "live");
  assert.equal(live.title, "omniSearch");

  const missing = await probeDocument("https://goldhobbang.github.io/missing/", {
    fetchImpl: async () => responseOf(404, "<title>Site not found · GitHub Pages</title>There isn't a GitHub Pages site here.", "https://goldhobbang.github.io/missing/"),
  });
  assert.equal(missing.verdict, "dead");

  const blocked = await probeDocument("https://goldhobbang.github.io/quiet/", {
    fetchImpl: async () => { throw new TypeError("Failed to fetch"); },
  });
  assert.equal(blocked.verdict, "blocked");

  const loop = await probeDocument("https://goldhobbang.github.io/portfolio/", {
    fetchImpl: async () => responseOf(200, "<!doctype html><title>home</title>", "https://goldhobbang.dev/"),
  });
  assert.equal(loop.reason, "self");
});

test("exposed frame policies mark a preview as blocked", () => {
  const headers = (map) => ({ get: (name) => map[name.toLowerCase()] || "" });
  assert.equal(frameBlockedByPolicy(headers({ "x-frame-options": "DENY" })), true);
  assert.equal(frameBlockedByPolicy(headers({ "content-security-policy": "frame-ancestors 'none'" })), true);
  assert.equal(frameBlockedByPolicy(headers({ "content-type": "text/html" })), false);
});

test("iframe framing is embedded only when the frame is cross-origin", () => {
  assert.equal(readFrameState({ location: { href: "about:blank" } }), "blocked");
  assert.equal(readFrameState({ get location() { const error = new Error("blocked"); error.name = "SecurityError"; throw error; } }), "embedded");
  assert.equal(publishedEntryUrls({ name: "PoomSa", defaultBranch: "main" })[0], "https://raw.githubusercontent.com/Goldhobbang/PoomSa/main/index.html");
});

test("GitHub Link headers yield the next page", () => {
  assert.equal(
    nextLink('<https://api.github.com/users/Goldhobbang/repos?per_page=100&page=2>; rel="next", <https://api.github.com/users/Goldhobbang/repos?per_page=100&page=3>; rel="last"'),
    "https://api.github.com/users/Goldhobbang/repos?per_page=100&page=2",
  );
  assert.equal(nextLink(null), null);
});
