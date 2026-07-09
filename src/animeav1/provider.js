
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

// Filtrar solo URLs que contengan "animeav1" (y que sean páginas de episodios)
function isAnimeAV1EpisodeUrl(url) {
  if (!url || typeof url !== 'string') return false;
  // Debe contener animeav1.com/media/ y terminar con un número
  const regex = /https?:\/\/(?:www\.)?animeav1\.com\/media\/[^\/]+\/\d+$/i;
  return regex.test(url.trim());
}

function extractVideoLinks(html, url) {
  const found = [];

  // 1. Buscar enlaces en atributos que puedan contener URLs
  const attrRegex = /(?:src|href|data-src|data-href|data-url|data-file|data-video|data-embed|data-source|data-stream)=["']([^"']*)["']/gi;
  let match;
  while ((match = attrRegex.exec(html)) !== null) {
    let videoUrl = match[1];
    if (!videoUrl.startsWith('http://') && !videoUrl.startsWith('https://')) {
      try {
        const base = new URL(url);
        videoUrl = new URL(videoUrl, base.origin).toString();
      } catch (_) { continue; }
    }
    if (videoUrl && isAnimeAV1EpisodeUrl(videoUrl) && !found.includes(videoUrl)) {
      found.push(videoUrl);
    }
  }

  // 2. Buscar en scripts (pueden contener URLs de animeav1)
  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let scriptMatch;
  while ((scriptMatch = scriptRegex.exec(html)) !== null) {
    const scriptContent = scriptMatch[1];
    const scriptUrls = scriptContent.match(/https?:\/\/[^\s"'<>]+animeav1\.com\/media\/[^\s"'<>]+\/\d+/gi) || [];
    scriptUrls.forEach(u => {
      if (isAnimeAV1EpisodeUrl(u) && !found.includes(u)) found.push(u);
    });
  }

  // 3. Buscar enlaces de descarga directa que apunten a animeav1
  const downloadRegex = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>[\s\S]*?(?:Descargar|download)[\s\S]*?<\/a>/gi;
  let downloadMatch;
  while ((downloadMatch = downloadRegex.exec(html)) !== null) {
    const urlCandidate = downloadMatch[1];
    if (urlCandidate && isAnimeAV1EpisodeUrl(urlCandidate) && !found.includes(urlCandidate)) {
      found.push(urlCandidate);
    }
  }

  // 4. Buscar cualquier URL que contenga animeav1.com/media/ y termine en número
  const generalRegex = /https?:\/\/(?:www\.)?animeav1\.com\/media\/[^\/]+\/\d+/gi;
  const generalUrls = html.match(generalRegex) || [];
  generalUrls.forEach(u => {
    if (isAnimeAV1EpisodeUrl(u) && !found.includes(u)) found.push(u);
  });

  // Eliminar duplicados
  return [...new Set(found)];
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
      let videoUrls = extractVideoLinks(html, episodeUrl);

      // Solo conservamos URLs que sean de animeav1 (ya filtrado en extractVideoLinks)
      if (videoUrls.length === 0) {
        return { server: "AnimeAV1", headers: {}, videoSources: [] };
      }

      // Convertir a videoSources (las URLs son páginas HTML, pero el usuario así lo quiere)
      const videoSources = videoUrls.map(url => ({
        url: url,
        type: 'html', // Aunque no es un video directo, lo dejamos como 'mp4' para que intente cargarlo
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
