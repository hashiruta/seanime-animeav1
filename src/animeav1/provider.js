/// <reference path="./online-streaming-provider.d.ts" />

const DEFAULT_DOMAIN = "animeav1.com";

const HTTP_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
};

async function fetchHtml(url) {
  const response = await fetch(url, { headers: HTTP_HEADERS });
  if (!response.ok) {
    throw new Error(`Error ${response.status} al obtener ${url}`);
  }
  return await response.text();
}

// ============================================================
// RESOLVEDOR ESPECÍFICO PARA ZILLA NETWORKS (FFmpeg con headers)
// ============================================================
async function resolveZillaUrl(zillaPageUrl) {
  try {
    // 1. Hacer fetch a la página de Zilla con headers específicos
    const response = await fetch(zillaPageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Referer": "https://animeav1.com/",
        "Origin": "https://animeav1.com",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (!response.ok) {
      console.warn("[Zilla Resolver] Error al obtener la página de Zilla:", response.status);
      return null;
    }
    const html = await response.text();

    // 2. Buscar el enlace al archivo .m3u8 (HLS) – patrón común en reproductores como JWPlayer
    // Patrones posibles:
    // - file: "https://...m3u8"
    // - src: "https://...m3u8"
    // - "https://...m3u8" dentro de un script
    const patterns = [
      /file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i,
      /src\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i,
      /source\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i,
      /"file"\s*:\s*"([^"]+\.m3u8[^"]*)"/i,
      /(https?:\/\/[^\s"']+\.m3u8[^\s"']*)/i,
    ];

    let m3u8Url = null;
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        m3u8Url = match[1];
        break;
      }
    }

    if (m3u8Url) {
      console.log("[Zilla Resolver] URL .m3u8 encontrada:", m3u8Url);
      return m3u8Url;
    }

    // 3. Si no encuentra .m3u8, buscar .mp4 directo (por si acaso)
    const mp4Match = html.match(/file\s*:\s*["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i) ||
                     html.match(/(https?:\/\/[^\s"']+\.mp4[^\s"']*)/i);
    if (mp4Match && mp4Match[1]) {
      console.log("[Zilla Resolver] URL .mp4 encontrada:", mp4Match[1]);
      return mp4Match[1];
    }

    console.warn("[Zilla Resolver] No se encontró ninguna URL de video en la página de Zilla.");
    return null;
  } catch (error) {
    console.error("[Zilla Resolver] Error:", error.message);
    return null;
  }
}

// ============================================================
// HELPERS DE SCRAPING (parser manual de literales JS)
// ============================================================

function extractBalancedSection(text, startIndex, openChar, closeChar) {
  let depth = 0;
  let quote = "";
  let escaped = false;

  for (let i = startIndex; i < text.length; i++) {
    const c = text[i];

    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (c === "\\") { escaped = true; continue; }
      if (c === quote) { quote = ""; continue; }
      continue;
    }

    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === openChar) depth++;
    if (c === closeChar) {
      depth--;
      if (depth === 0) return text.slice(startIndex, i + 1);
    }
  }

  return null;
}

function parseJsLiteral(input) {
  let i = 0;

  const skipWs = () => {
    while (i < input.length && /\s/.test(input[i])) i++;
  };

  const parseValue = () => {
    skipWs();
    const c = input[i];
    if (c === "{") return parseObject();
    if (c === "[") return parseArray();
    if (c === '"' || c === "'" || c === "`") return parseString();
    if (c === "-" || (c >= "0" && c <= "9")) return parseNumber();
    return parseWord();
  };

  const parseObject = () => {
    const obj = {};
    i++; // {
    skipWs();
    if (input[i] === "}") { i++; return obj; }
    while (true) {
      skipWs();
      const key = parseKey();
      skipWs();
      if (input[i] !== ":") throw new Error("PARSE: se esperaba ':' en posicion " + i);
      i++;
      const value = parseValue();
      obj[key] = value;
      skipWs();
      if (input[i] === ",") {
        i++;
        skipWs();
        if (input[i] === "}") { i++; break; }
        continue;
      }
      if (input[i] === "}") { i++; break; }
      throw new Error("PARSE: token inesperado en objeto, posicion " + i);
    }
    return obj;
  };

  const parseKey = () => {
    skipWs();
    const c = input[i];
    if (c === '"' || c === "'" || c === "`") return parseString();
    const start = i;
    while (i < input.length && /[A-Za-z0-9_$]/.test(input[i])) i++;
    if (i === start) throw new Error("PARSE: clave vacia en posicion " + i);
    return input.slice(start, i);
  };

  const parseArray = () => {
    const arr = [];
    i++; // [
    skipWs();
    if (input[i] === "]") { i++; return arr; }
    while (true) {
      arr.push(parseValue());
      skipWs();
      if (input[i] === ",") {
        i++;
        skipWs();
        if (input[i] === "]") { i++; break; }
        continue;
      }
      if (input[i] === "]") { i++; break; }
      throw new Error("PARSE: token inesperado en array, posicion " + i);
    }
    return arr;
  };

  const parseString = () => {
    const quote = input[i];
    i++;
    let result = "";
    while (i < input.length && input[i] !== quote) {
      if (input[i] === "\\") {
        i++;
        const esc = input[i];
        if (esc === "n") result += "\n";
        else if (esc === "t") result += "\t";
        else if (esc === "r") result += "\r";
        else result += esc;
        i++;
      } else {
        result += input[i];
        i++;
      }
    }
    i++; // comilla de cierre
    return result;
  };

  const parseNumber = () => {
    const start = i;
    if (input[i] === "-") i++;
    while (i < input.length && /[0-9.eE+\-]/.test(input[i])) i++;
    return Number(input.slice(start, i));
  };

  const parseWord = () => {
    const start = i;
    while (i < input.length && /[A-Za-z0-9_$]/.test(input[i])) i++;
    const word = input.slice(start, i);
    if (word === "true") return true;
    if (word === "false") return false;
    if (word === "null") return null;
    if (word === "undefined") return null;
    if (word === "") throw new Error("PARSE: valor inesperado en posicion " + i);
    return word;
  };

  return parseValue();
}

function safeEval(objectLiteral) {
  try {
    return parseJsLiteral(objectLiteral);
  } catch (_e) {
    return null;
  }
}

function walk(value, visitor, seen = []) {
  if (!value || typeof value !== "object") return;
  if (seen.indexOf(value) !== -1) return;
  seen.push(value);

  visitor(value);

  if (Array.isArray(value)) {
    for (const item of value) walk(item, visitor, seen);
    return;
  }
  for (const key of Object.keys(value)) walk(value[key], visitor, seen);
}

function extractSvelteData(html) {
  const marker = "__sveltekit_";
  let pointer = html.indexOf(marker);

  while (pointer !== -1) {
    const eq = html.indexOf("=", pointer);
    if (eq === -1) break;

    const objStart = html.indexOf("{", eq);
    if (objStart === -1) break;

    const literal = extractBalancedSection(html, objStart, "{", "}");
    if (literal) {
      const payload = safeEval(literal);
      if (payload && Array.isArray(payload.data)) {
        return payload.data;
      }
    }

    pointer = html.indexOf(marker, pointer + marker.length);
  }

  return null;
}

function extractSvelteDataViaDataKey(html) {
  const candidates = [];
  let pointer = html.indexOf("data:");

  while (pointer !== -1) {
    let bracketStart = pointer + "data:".length;
    while (bracketStart < html.length && /\s/.test(html[bracketStart])) bracketStart++;

    if (html[bracketStart] === "[") {
      const literal = extractBalancedSection(html, bracketStart, "[", "]");
      if (literal) {
        const parsed = safeEval(literal);
        if (Array.isArray(parsed) && parsed.length > 0) {
          candidates.push(parsed);
        }
      }
    }

    pointer = html.indexOf("data:", pointer + "data:".length);
  }

  return candidates;
}

function pickCandidateWithLinks(candidates) {
  for (const candidate of candidates) {
    let found = false;
    walk(candidate, (node) => {
      if (node.streamLinks || node.downloadLinks || node.servers) found = true;
    });
    if (found) return candidate;
  }
  return null;
}

function normalizeLinkObject(entry) {
  if (!entry) return null;

  if (typeof entry === "string") {
    return { server: hostOf(entry), url: entry, quality: null };
  }

  const url = entry.url || entry.href || entry.link || entry.embed || entry.file;
  if (!url) return null;

  return {
    server: entry.server || entry.name || hostOf(url),
    url,
    quality: entry.quality || entry.resolution || null,
  };
}

function parseVariantContainer(container, kind, collector) {
  if (!container) return;

  const subArr = container.SUB || container.sub;
  const dubArr = container.DUB || container.dub;

  if (Array.isArray(subArr)) {
    for (const entry of subArr) {
      const link = normalizeLinkObject(entry);
      if (link) collector[kind].SUB.push(link);
    }
  }
  if (Array.isArray(dubArr)) {
    for (const entry of dubArr) {
      const link = normalizeLinkObject(entry);
      if (link) collector[kind].DUB.push(link);
    }
  }
}

function extractLinksFromData(dataRoot) {
  const collector = {
    stream: { SUB: [], DUB: [] },
    download: { SUB: [], DUB: [] },
  };

  walk(dataRoot, (node) => {
    if (node.streamLinks) parseVariantContainer(node.streamLinks, "stream", collector);
    if (node.downloadLinks) parseVariantContainer(node.downloadLinks, "download", collector);
    if (node.servers) parseVariantContainer(node.servers, "stream", collector);
  });

  return collector;
}

function hostOf(url) {
  try {
    const match = /^https?:\/\/(?:www\.)?([^/]+)/i.exec(url);
    return match ? match[1] : "server";
  } catch (_e) {
    return "server";
  }
}

function chooseBestMediaCandidate(dataRoot) {
  if (!dataRoot) return null;
  let best = null;
  let bestScore = -1;

  walk(dataRoot, (node) => {
    if (typeof node.title !== "string") return;
    if (!Array.isArray(node.episodes) && !node.description) return;

    let score = 0;
    if (typeof node.title === "string") score += 3;
    if (Array.isArray(node.episodes)) score += 3;
    if (node.description) score += 1;

    if (score > bestScore) {
      best = node;
      bestScore = score;
    }
  });

  return best;
}

// ============================================================
// PROVIDER PRINCIPAL
// ============================================================

class Provider {
  constructor() {
    this.currentSlug = null;
    this.api = "https://animeav1.com";
  }

  getSettings() {
    return {
      episodeServers: ["AnimeAV1"],
      supportsDub: false,
    };
  }

  // ---------- SEARCH ----------
  async search(opts) {
    const searchText = (opts && opts.query) || "";
    if (!searchText) return [];

    const raw = await this.searchAnimeAV1(searchText);
    return raw.map((r) => ({
      id: r.slug,
      title: r.title,
      url: r.url,
      subOrDub: "sub",
    }));
  }

  async searchAnimeAV1(query) {
    const url = `${this.api}/catalogo?search=${encodeURIComponent(query)}`;

    let res;
    try {
      res = await fetch(url);
    } catch (e) {
      throw new Error(`FETCH_FAILED al pedir ${url} -> ${e.message}`);
    }

    if (!res || res.status >= 400) {
      throw new Error(`HTTP_ERROR status=${res ? res.status : "sin respuesta"} al pedir ${url}`);
    }

    let html;
    try {
      html = await res.text();
    } catch (e) {
      throw new Error(`TEXT_PARSE_FAILED -> ${e.message}`);
    }

    if (!html || html.length < 100) {
      throw new Error(`HTML_VACIO_O_MUY_CORTO length=${html ? html.length : 0}`);
    }

    const results = [];

    // Camino 1: datos estructurados embebidos
    const svelteData = extractSvelteData(html);
    if (svelteData) {
      walk(svelteData, (node) => {
        if (
          (typeof node.title === "string" || typeof node.name === "string") &&
          (node.slug || node.url)
        ) {
          results.push(node);
        }
      });
    }

    // Camino 2 (fallback): parseo directo del HTML con LoadDoc
    if (results.length === 0) {
      try {
        const $ = LoadDoc(html);
        let selection;
        try {
          selection = $("a[href^='/media/']");
        } catch (_e) {
          selection = $('a[href^="/media/"]');
        }

        selection.each((_i, el) => {
          const href = el.attr("href");
          let h3h2 = "";
          try { h3h2 = el.find("h3, h2").first().text(); } catch (_e) {}
          let imgAlt = "";
          try { imgAlt = el.find("img").attr("alt"); } catch (_e) {}
          const fullText = (() => { try { return el.text(); } catch (_e) { return ""; } })();

          const slugFromHref = (href || "").replace("/media/", "");
          const titleFromSlug = slugFromHref
            .split("-")
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" ");

          let title = (h3h2 && h3h2.trim()) || (imgAlt && imgAlt.trim()) || (fullText && fullText.trim()) || titleFromSlug;
          title = title.replace(/^Ver\s+/i, "").trim();

          if (href && title) {
            results.push({ title, slug: slugFromHref, url: `${this.api}${href}` });
          }
        });
      } catch (_e) {
        // fallback silencioso
      }
    }

    const q = this.normalize(query);
    const filtered = results.filter((r) => this.normalize(r.title || r.name || "").includes(q));
    const finalList = filtered.length > 0 ? filtered : results;

    return finalList.slice(0, 20).map((r) => ({
      title: r.title || r.name,
      slug: r.slug || (r.url || "").replace(`${this.api}/media/`, ""),
      url: r.url
        ? r.url.startsWith("http")
          ? r.url
          : `${this.api}${r.url}`
        : `${this.api}/media/${r.slug}`,
    }));
  }

  normalize(s) {
    return (s || "").toLowerCase().trim();
  }

  // ---------- FIND EPISODES ----------
  async findEpisodes(id) {
    this.currentSlug = id;
    const baseUrl = `${this.api}/media/${id}`;

    // Intento 1: endpoint __data.json
    const viaDataJson = await this.tryFindEpisodesViaDataJson(baseUrl, id);
    if (viaDataJson.length > 0) return viaDataJson;

    const res = await fetch(baseUrl);
    const html = await res.text();

    // Intento 2: blob de hidratación embebido
    const svelteData = extractSvelteData(html);
    const media = chooseBestMediaCandidate(svelteData);
    if (media && Array.isArray(media.episodes) && media.episodes.length > 0) {
      return media.episodes.map((ep, idx) => this.toEpisodeObject(ep, idx, id));
    }

    // Intento 3: scraping HTML directo
    return this.findEpisodesViaHtmlFallback(html, id);
  }

  toEpisodeObject(ep, idx, id) {
    const num = ep.number || ep.episode || ep.ep || (idx + 1);
    return {
      id: `${id}/${num}`,
      number: num,
      title: ep.title || `Episodio ${num}`,
      url: `${this.api}/media/${id}/${num}`,
    };
  }

  async tryFindEpisodesViaDataJson(baseUrl, id) {
    try {
      const res = await fetch(`${baseUrl}/__data.json`);
      if (!res || res.status >= 400) return [];
      const text = await res.text();
      const data = JSON.parse(text);

      let episodesFound = [];
      walk(data, (node) => {
        if (Array.isArray(node.episodes) && node.episodes.length > 0) {
          episodesFound = node.episodes;
        }
      });
      if (episodesFound.length === 0) return [];
      return episodesFound.map((ep, idx) => this.toEpisodeObject(ep, idx, id));
    } catch (_e) {
      return [];
    }
  }

  findEpisodesViaHtmlFallback(html, id) {
    const results = [];
    try {
      const $ = LoadDoc(html);
      const prefix = `/media/${id}/`;

      let selection;
      try {
        selection = $(`a[href^='${prefix}']`);
      } catch (_e) {
        selection = $(`a[href^="${prefix}"]`);
      }

      const seen = {};
      selection.each((_i, el) => {
        const href = el.attr("href");
        if (!href) return;
        const tail = href.slice(prefix.length);
        const num = parseInt(tail, 10);
        if (isNaN(num) || seen[num]) return;
        seen[num] = true;

        let text = "";
        try { text = el.text(); } catch (_e) {}
        text = (text || "").replace(/^Ver\s+/i, "").trim();

        results.push({
          id: `${id}/${num}`,
          number: num,
          title: text || `Episodio ${num}`,
          url: `${this.api}${href}`,
        });
      });
    } catch (_e) {
      // sin resultados
    }

    results.sort((a, b) => a.number - b.number);
    return results;
  }

  // ---------- FIND EPISODE SERVER ----------
  async findEpisodeServer(episode, _server) {
    if (!episode || !episode.url) {
      throw new Error("No se recibió una URL de episodio válida (episode.url está vacío)");
    }

    // Intento 1: endpoint __data.json del episodio
    const viaDataJson = await this.tryFindServerViaDataJson(episode.url);
    if (viaDataJson) return viaDataJson;

    const res = await fetch(episode.url);
    const html = await res.text();

    // Intento 2: blob de hidratación embebido (marcador __sveltekit_)
    const svelteData = extractSvelteData(html);
    const links = extractLinksFromData(svelteData);
    let streamLinks = links.stream.SUB.length ? links.stream.SUB : links.stream.DUB;

    // Intento 2b: búsqueda directa del patrón "data: [...]" (sin depender del marcador)
    if (!streamLinks.length) {
      const candidates = extractSvelteDataViaDataKey(html);
      const bestCandidate = pickCandidateWithLinks(candidates);
      if (bestCandidate) {
        const links2 = extractLinksFromData(bestCandidate);
        streamLinks = links2.stream.SUB.length ? links2.stream.SUB : links2.stream.DUB;
      }
    }

    // Intento 3: scrapeo de iframes/embeds directo del HTML
    if (!streamLinks.length) {
      streamLinks = this.findServerLinksViaHtmlFallback(html);
    }

    if (!streamLinks.length) {
      throw new Error("No se encontraron servidores de video para este episodio");
    }

    // ============================================================
    //  RESOLVEDOR PARA ZILLA NETWORKS (FFmpeg con headers)
    // ============================================================
    // Si el servidor es Zilla, intentar resolver la URL real del .m3u8
    const finalStreamLinks = [];
    for (const link of streamLinks) {
      let resolvedUrl = link.url;
      if (link.url.includes('zilla-networks.com/play/')) {
        const realUrl = await resolveZillaUrl(link.url);
        if (realUrl) {
          resolvedUrl = realUrl;
          // Cambiamos el nombre del servidor para indicar que es HLS
          link.server = "Zilla (HLS)";
        } else {
          // Si no se pudo resolver, omitimos este enlace
          continue;
        }
      }
      // Si es un enlace de MP4Upload o Mega, también podríamos resolverlos aquí (opcional)
      finalStreamLinks.push({
        server: link.server,
        url: resolvedUrl,
        quality: link.quality || "default",
      });
    }

    if (finalStreamLinks.length === 0) {
      throw new Error("No se pudo resolver ningún enlace de video (Zilla u otros)");
    }

    // Construir videoSources con headers
    const videoSources = finalStreamLinks.map((l) => ({
      url: l.url,
      quality: l.quality || "default",
      type: /m3u8/i.test(l.url) ? "m3u8" : "mp4",
      headers: {
        "Referer": "https://animeav1.com/",
        "Origin": "https://animeav1.com",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
    }));

    return {
      server: finalStreamLinks[0].server,
      videoSources: videoSources,
    };
  }

  async tryFindServerViaDataJson(episodeUrl) {
    try {
      const res = await fetch(`${episodeUrl}/__data.json`);
      if (!res || res.status >= 400) return null;
      const text = await res.text();
      const data = JSON.parse(text);

      const links = extractLinksFromData(data);
      let streamLinks = links.stream.SUB.length ? links.stream.SUB : links.stream.DUB;
      if (!streamLinks.length) return null;

      // También aplicar resolvedor Zilla si está presente en __data.json
      const finalLinks = [];
      for (const link of streamLinks) {
        let resolvedUrl = link.url;
        if (link.url.includes('zilla-networks.com/play/')) {
          const realUrl = await resolveZillaUrl(link.url);
          if (realUrl) {
            resolvedUrl = realUrl;
            link.server = "Zilla (HLS)";
          } else {
            continue;
          }
        }
        finalLinks.push({
          server: link.server,
          url: resolvedUrl,
          quality: link.quality || "default",
        });
      }

      if (finalLinks.length === 0) return null;

      return {
        server: finalLinks[0].server,
        videoSources: finalLinks.map((l) => ({
          url: l.url,
          quality: l.quality || "default",
          type: /m3u8/i.test(l.url) ? "m3u8" : "mp4",
          headers: {
            "Referer": "https://animeav1.com/",
            "Origin": "https://animeav1.com",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          },
        })),
      };
    } catch (_e) {
      return null;
    }
  }

  findServerLinksViaHtmlFallback(html) {
    const results = [];
    try {
      const $ = LoadDoc(html);

      // 1) iframes con src directo
      let iframes = null;
      try { iframes = $("iframe"); } catch (_e) {}
      if (iframes) {
        iframes.each((_i, el) => {
          let src = "";
          try { src = el.attr("src"); } catch (_e) {}
          if (src) results.push({ server: hostOf(src), url: src, quality: "default" });
        });
      }

      // 2) botones/elementos con atributos data-*
      const dataAttrs = ["data-src", "data-embed", "data-url", "data-video", "data-player"];
      for (const attr of dataAttrs) {
        let elements = null;
        try { elements = $(`[${attr}]`); } catch (_e) {}
        if (!elements) continue;
        elements.each((_i, el) => {
          let val = "";
          try { val = el.attr(attr); } catch (_e) {}
          if (val && /^https?:\/\//i.test(val)) {
            results.push({ server: hostOf(val), url: val, quality: "default" });
          }
        });
      }
    } catch (_e) {
      // sin resultados
    }

    // Deduplicar por URL
    const seenUrls = {};
    const deduped = results.filter((r) => {
      if (seenUrls[r.url]) return false;
      seenUrls[r.url] = true;
      return true;
    });

    return deduped;
  }
}
module.exports = { provider: Provider };
