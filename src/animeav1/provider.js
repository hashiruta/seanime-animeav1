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

function extractEpisodesFromHtml(html, baseUrl) {
  const episodes = [];
  const regex = /href="\/media\/([^\/]+)\/(\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const slug = match[1];
    const epNumber = parseInt(match[2], 10);
    const linkText = match[3].replace(/<[^>]*>/g, '').trim();
    const title = linkText || `Episodio ${epNumber}`;
    episodes.push({
      id: String(epNumber),
      number: epNumber,
      title: title,
      url: `https://${DEFAULT_DOMAIN}/media/${slug}/${epNumber}`,
    });
  }

  if (episodes.length === 0) {
    const altRegex = /href="\/media\/[^\/]+\/(\d+)"/gi;
    let altMatch;
    const seen = new Set();
    while ((altMatch = altRegex.exec(html)) !== null) {
      const epNumber = parseInt(altMatch[1], 10);
      if (!isNaN(epNumber) && !seen.has(epNumber)) {
        seen.add(epNumber);
        const slugMatch = baseUrl.match(/\/media\/([^\/]+)/);
        const slug = slugMatch ? slugMatch[1] : "anime";
        episodes.push({
          id: String(epNumber),
          number: epNumber,
          title: `Episodio ${epNumber}`,
          url: `https://${DEFAULT_DOMAIN}/media/${slug}/${epNumber}`,
        });
      }
    }
  }

  episodes.sort((a, b) => a.number - b.number);
  return episodes;
}

function extractVideoLinks(html, url) {
  const found = [];

  const attrRegex = /(?:src|href|data-src|data-href)=["']([^"']*\.(?:m3u8|mp4|webm|mkv|avi|embed|player|pixeldrain|mega|mp4upload|1fichier|zilla|uns\.bio)[^"']*)["']/gi;
  let match;
  while ((match = attrRegex.exec(html)) !== null) {
    let videoUrl = match[1];
    if (!videoUrl.startsWith('http://') && !videoUrl.startsWith('https://')) {
      try {
        const base = new URL(url);
        videoUrl = new URL(videoUrl, base.origin).toString();
      } catch (_) { continue; }
    }
    if (videoUrl && !found.includes(videoUrl)) {
      found.push(videoUrl);
    }
  }

  if (found.length === 0) {
    const generalRegex = /https?:\/\/(?:www\.)?(?:pixeldrain\.com|mega\.nz|mp4upload\.com|1fichier\.com|player\.[^\s"'<>]+|[^\s"'<>]*zilla[^\s"'<>]*|[^\s"'<>]*uns\.bio[^\s"'<>]*)[^\s"'<>]*/gi;
    const generalUrls = html.match(generalRegex) || [];
    generalUrls.forEach(u => { if (!found.includes(u)) found.push(u); });
  }

  if (found.length === 0) {
    const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    let scriptMatch;
    while ((scriptMatch = scriptRegex.exec(html)) !== null) {
      const scriptContent = scriptMatch[1];
      const scriptUrls = scriptContent.match(/https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4|embed|player|pixeldrain|mega|mp4upload|1fichier|zilla|uns\.bio)[^\s"'<>]*/gi) || [];
      scriptUrls.forEach(u => { if (!found.includes(u)) found.push(u); });
    }
  }

  return found;
}

async function resolveStreamwish(url) {
  try {
    const html = await fetchHtml(url);
    let match = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
    if (match && match[1]) return match[1];
    match = html.match(/data-src=["']([^"']+\.m3u8[^"']*)["']/i);
    if (match && match[1]) return match[1];
    const scriptMatch = html.match(/<script[^>]*>([\s\S]*?var\s+sources\s*=\s*\[[\s\S]*?\];[\s\S]*?)<\/script>/i);
    if (scriptMatch) {
      const urlMatch = scriptMatch[1].match(/src\s*:\s*["'](https?:\/\/[^"']+)["']/i);
      if (urlMatch && urlMatch[1]) return urlMatch[1];
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function resolveStreamtape(url) {
  try {
    const html = await fetchHtml(url);
    const match = html.match(/document\.getElementById\('norobotlink'\)\.innerHTML\s*=\s*(.+?);/);
    if (!match) return null;
    const tokenMatch = match[1].match(/token=([^&']+)/);
    if (!tokenMatch) return null;
    const token = tokenMatch[1];
    const streamtapeMatch = html.match(/id\s*=\s*"ideoooolink"/);
    if (!streamtapeMatch) return null;
    const tagEnd = html.indexOf(">", streamtapeMatch.index) + 1;
    const videoUrl = html.substring(tagEnd, html.indexOf("<", tagEnd));
    return `https:${videoUrl}&token=${token}&dl=1`;
  } catch (e) {
    return null;
  }
}

async function resolveVoe(url) {
  try {
    const html = await fetchHtml(url);
    let match = html.match(/(https?:\/\/[^\s"'<>]+\.(?:mp4|m3u8)[^\s"'<>]*)/i);
    if (match && match[1]) return match[1];
    match = html.match(/src=["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/i);
    if (match && match[1]) return match[1];
    return null;
  } catch (e) {
    return null;
  }
}

async function resolveMP4Upload(url) {
  try {
    const html = await fetchHtml(url);
    const match = html.match(/<script(?:.|\n)+?src:(?:.|\n)*?"(.+?\.mp4)"/);
    if (match && match[1]) return match[1];
    return null;
  } catch (e) {
    return null;
  }
}

async function resolvePDrain(url) {
  try {
    const match = url.match(/(.+?:\/\/.+?)\/.+?\/(.+?)(?:\?embed)?$/);
    if (match && match[1] && match[2]) {
      return `${match[1]}/api/file/${match[2]}`;
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function resolveVideoUrl(url) {
  if (!url) return null;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    const resolvers = [
      { pattern: /wish|playnix|medix|niramirus|kravaxxa|davioad|haxlopp|tryzendm|dumbalag|dhcplay|hglink/i, fn: resolveStreamwish },
      { pattern: /streamtape/i, fn: resolveStreamtape },
      { pattern: /voe/i, fn: resolveVoe },
      { pattern: /mp4upload/i, fn: resolveMP4Upload },
      { pattern: /pixeldrain|pdrain/i, fn: resolvePDrain },
    ];
    for (const resolver of resolvers) {
      if (resolver.pattern.test(hostname)) {
        const resolved = await resolver.fn(url);
        if (resolved) return resolved;
      }
    }
    return url;
  } catch (e) {
    return null;
  }
}

class Provider {
  constructor() {
    this.currentSlug = null;
  }

  getSettings() {
    return { episodeServers: ["AnimeAV1"], supportsDub: false };
  }

  async search(opts) {
    if (!opts.query || opts.query.trim() === '') return [];
    try {
      const query = encodeURIComponent(opts.query.trim());
      const url = `https://${DEFAULT_DOMAIN}/catalogo?search=${query}`;
      const html = await fetchHtml(url);

      const results = [];
      const regex = /<a[^>]*href="\/media\/([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let match;
      while ((match = regex.exec(html)) !== null) {
        const slug = match[1];
        const titleMatch = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(match[2]);
        const title = titleMatch ? titleMatch[1].trim() : slug;
        if (!results.some(r => r.id === slug)) {
          results.push({
            id: slug,
            title: title,
            url: `https://${DEFAULT_DOMAIN}/media/${slug}`,
            subOrDub: 'sub',
          });
        }
      }
      return results.slice(0, 20);
    } catch (error) {
      return [];
    }
  }

  async findEpisodes(id) {
    this.currentSlug = id;
    try {
      const url = `https://${DEFAULT_DOMAIN}/media/${id}`;
      const html = await fetchHtml(url);
      const episodes = extractEpisodesFromHtml(html, url);
      return episodes.map(ep => ({
        id: ep.id,
        number: ep.number,
        url: ep.url,
        title: ep.title,
      }));
    } catch (error) {
      return [];
    }
  }

  async findEpisodeServer(episode, server) {
    let slug = this.currentSlug;
    if (!slug && episode.url) {
      const match = episode.url.match(/\/media\/([^\/]+)\//);
      if (match) slug = match[1];
    }
    if (!slug) {
      return { server: "AnimeAV1", headers: {}, videoSources: [] };
    }

    try {
      const episodeUrl = `https://${DEFAULT_DOMAIN}/media/${slug}/${episode.id}`;
      const html = await fetchHtml(episodeUrl);
      const videoUrls = extractVideoLinks(html, episodeUrl);

      const resolvedUrls = [];
      for (const url of videoUrls) {
        if (url.includes('zilla-networks.com')) continue;
        const resolved = await resolveVideoUrl(url);
        if (resolved && !resolvedUrls.includes(resolved)) {
          resolvedUrls.push(resolved);
        }
      }

      if (resolvedUrls.length === 0) {
        return { server: "AnimeAV1", headers: {}, videoSources: [] };
      }

      const videoSources = resolvedUrls.map(url => ({
        url: url,
        type: url.includes('.m3u8') ? 'm3u8' : 'mp4',
        quality: '1080p',
      }));

      return {
        server: "AnimeAV1",
        headers: {
          "Referer": "https://animeav1.com/",
          "Origin": "https://animeav1.com"
        },
        videoSources: videoSources,
      };
    } catch (error) {
      return { server: "AnimeAV1", headers: {}, videoSources: [] };
    }
  }
}

module.exports = { provider: Provider };
