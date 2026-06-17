// Sitemap + llms.txt parsing. Uses DOMParser (browser / jsdom) and pure URL helpers.

import { cleanText } from "./text.js";
import { resolveLoadedUrl, cleanMarkdownHref, trimUrlTail } from "./url.js";

export function xmlElements(doc, tagName) {
  const elements = [
    ...doc.getElementsByTagName(tagName),
    ...doc.getElementsByTagNameNS("*", tagName)
  ];
  return [...new Set(elements)];
}

export function childLocText(element) {
  const loc = [...element.children].find((child) => child.localName?.toLowerCase() === "loc");
  return cleanText(loc?.textContent);
}

export function parseSitemapXml(xml, baseUrl, parser = new DOMParser()) {
  const doc = parser.parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("The sitemap could not be parsed as XML.");
  }

  const urls = xmlElements(doc, "url")
    .map((element) => childLocText(element))
    .map((url) => resolveLoadedUrl(url, baseUrl))
    .filter(Boolean);
  const sitemaps = xmlElements(doc, "sitemap")
    .map((element) => childLocText(element))
    .map((url) => resolveLoadedUrl(url, baseUrl))
    .filter(Boolean);

  return { urls, sitemaps };
}

export function extractLlmsUrls(text, baseUrl) {
  const urls = [];
  const markdownLinkPattern = /!?\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  const bareUrlPattern = /https?:\/\/[^\s<>"'`)\]]+/gi;
  let match;

  while ((match = markdownLinkPattern.exec(text)) !== null) {
    urls.push(resolveLoadedUrl(cleanMarkdownHref(match[1]), baseUrl));
  }

  while ((match = bareUrlPattern.exec(text)) !== null) {
    urls.push(resolveLoadedUrl(trimUrlTail(match[0]), baseUrl));
  }

  return urls.filter(Boolean);
}
