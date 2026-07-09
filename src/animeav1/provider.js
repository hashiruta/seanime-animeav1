/// <reference path="./online-streaming-provider.d.ts" />

// --- Configuración ---
const DEFAULT_DOMAIN = "animeav1.com";

const HTTP_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
};

// --- Utilidades ---
async function fetchHtml(url) {
  console.log("[AnimeAV1] Fetching:", url);
  const response = await fetch(url, { headers: HTTP_HEADERS });
  if (!response.ok) {
    throw new Error(`Error ${response.status} al obtener ${url}`);
  }
  return await response.text();
}

function extractEpisodesFromHtml(html, baseUrl) {
  const episodes = [];
  // Buscar todos los enlaces a episodios en el formato /media/slug/numero
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
  
  // Si no encontró con el patrón anterior, intentar con uno más simple
  if (episodes.length === 0) {
    const altRegex = /href="\/media\/[^\/]+\/(\d+)"/gi;
    let altMatch;
    const seen = new Set();
    while ((altMatch = altRegex.exec(html)) !== null) {
      const epNumber = parseInt(altMatch[1], 10);
      if (!isNaN(epNumber) && !seen.has(epNumber)) {
        seen.add(epNumber);
        // Intentar extraer el slug de la URL base
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

function extractVideoLinks(html) {
  // Buscar cualquier URL de video o stream
  const urlRegex = /https?:\/\/(?:www\.)?(?:pixeldrain\.com|mega\.nz|mp4upload\.com|1fichier\.com|player\.[^\s"'<>]+|[^\s"'<>]*zilla[^\s"'<>]*|[^\s"'<>]*uns\.bio[^\s"'<>]*)[^\s"'<>]*/gi;
  const found = html.match(urlRegex) || [];
  
  // Si no encuentra enlaces, buscar en scripts
  if (found.length === 0) {
    const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    let scriptMatch;
    while ((scriptMatch = scriptRegex.exec(html)) !== null) {
      const scriptContent = scriptMatch[1];
      const scriptUrls = scriptContent.match(urlRegex);
      if (scriptUrls) {
        return scriptUrls;
      }
    }
  }
  return found;
}

// --- Clase Provider para Seanime ---
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
      
      // Extraer resultados de búsqueda
      const results = [];
      const regex = /<a[^>]*href="\/media\/([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let match;
      while ((match = regex.exec(html)) !== null) {
        const slug = match[1];
        const titleMatch = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(match[2]);
        const title = titleMatch ? titleMatch[1].trim() : slug;
        // Evitar duplicados
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
      console.error("Error en search:", error);
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
      console.error("Error en findEpisodes:", error);
      return [];
    }
  }

  async findEpisodeServer(episode, server) {
    try {
      const episodeUrl = `https://${DEFAULT_DOMAIN}/media/${this.currentSlug}/${episode.id}`;
      const html = await fetchHtml(episodeUrl);
      const videoUrls = extractVideoLinks(html);
      
      if (videoUrls.length === 0) {
        return { server: "AnimeAV1", headers: {}, videoSources: [] };
      }
      
      return {
        server: "AnimeAV1",
        headers: {},
        videoSources: videoUrls.map(url => ({
          url: url,
          type: url.includes('.m3u8') ? 'm3u8' : 'mp4',
          quality: '1080p',
        })),
      };
    } catch (error) {
      console.error("Error en findEpisodeServer:", error);
      return { server: "AnimeAV1", headers: {}, videoSources: [] };
    }
  }
}

// Para el repositorio: descomenta esta línea
module.exports = { provider: Provider };
