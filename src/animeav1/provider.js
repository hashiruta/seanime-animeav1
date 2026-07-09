/// <reference path="./online-streaming-provider.d.ts" />

// --- Configuración y utilidades básicas ---
const DEFAULT_DOMAIN = "animeav1.com";

const HTTP_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
};

async function fetchHtml(url) {
  console.log("[AnimeAV1] Fetching:", url);
  const response = await fetch(url, { headers: HTTP_HEADERS });
  if (!response.ok) {
    throw new Error(`Error ${response.status} al obtener ${url}`);
  }
  const html = await response.text();
  console.log("[AnimeAV1] HTML length:", html.length);
  // Muestra los primeros 500 caracteres para depurar
  console.log("[AnimeAV1] HTML preview:", html.substring(0, 500));
  return html;
}

function extractSvelteData(html) {
  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    const scriptContent = match[1];
    if (!scriptContent.includes("__sveltekit_") || !scriptContent.includes("data:")) continue;
    const dataMarker = scriptContent.indexOf("data:");
    if (dataMarker === -1) continue;
    const listStart = scriptContent.indexOf("[", dataMarker);
    if (listStart === -1) continue;
    let depth = 0, end = listStart;
    for (let i = listStart; i < scriptContent.length; i++) {
      if (scriptContent[i] === '[') depth++;
      else if (scriptContent[i] === ']') {
        depth--;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    if (depth !== 0) continue;
    const arrayStr = scriptContent.substring(listStart, end);
    try {
      const data = new Function(`return (${arrayStr})`)();
      if (Array.isArray(data)) return data;
    } catch (_) {}
  }
  return null;
}

async function searchAnime(query) {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];
  const domain = DEFAULT_DOMAIN;
  const searchUrl = `https://${domain}/catalogo?search=${encodeURIComponent(cleanQuery)}`;
  try {
    const html = await fetchHtml(searchUrl);
    const svelteData = extractSvelteData(html);
    if (svelteData) {
      for (const item of svelteData) {
        if (Array.isArray(item) && item.length > 0 && item[0]?.title) {
          return item.map(result => ({
            id: result.slug || result.id || result.url,
            title: result.title || result.name,
            url: result.url || `https://${domain}/media/${result.slug}`,
            image: result.poster || result.image || null,
            type: result.type || null,
            year: result.year || null,
          })).filter(r => r.title);
        }
      }
    }
    // Fallback: parseo básico
    const results = [];
    const linkRegex = /<a[^>]*href="\/media\/([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      const slug = match[1];
      const titleMatch = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(match[2]);
      const title = titleMatch ? titleMatch[1].trim() : slug;
      results.push({ id: slug, title, url: `https://${domain}/media/${slug}` });
    }
    const unique = results.filter((v, i, a) => a.findIndex(t => t.url === v.url) === i);
    return unique.slice(0, 20);
  } catch (error) {
    console.error("Error en searchAnime:", error);
    return [];
  }
}

async function getAnimeInfo(url) {
  try {
    const html = await fetchHtml(url);
    const svelteData = extractSvelteData(html);
    if (!svelteData) {
      // Fallback: parsear el HTML directamente
      console.log("[AnimeAV1] No se encontraron datos Svelte, usando fallback HTML");
      const episodes = [];
      // Buscar enlaces a episodios (ej. /media/slug/1)
      const epRegex = /<a[^>]*href="\/media\/[^/]+\/(\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let match;
      while ((match = epRegex.exec(html)) !== null) {
        const epNumber = parseInt(match[1], 10);
        const title = match[2].replace(/<[^>]*>/g, '').trim() || `Episodio ${epNumber}`;
        episodes.push({
          id: String(epNumber),
          number: epNumber,
          title: title,
          url: `${url}/${epNumber}`,
        });
      }
      // Si no encuentra episodios, intentar con otro patrón
      if (episodes.length === 0) {
        const altRegex = /href="\/media\/[^/]+\/(\d+)"[^>]*>/gi;
        let altMatch;
        const epSet = new Set();
        while ((altMatch = altRegex.exec(html)) !== null) {
          const epNumber = parseInt(altMatch[1], 10);
          if (!isNaN(epNumber) && !epSet.has(epNumber)) {
            epSet.add(epNumber);
            episodes.push({
              id: String(epNumber),
              number: epNumber,
              title: `Episodio ${epNumber}`,
              url: `${url}/${epNumber}`,
            });
          }
        }
      }
      // Ordenar por número
      episodes.sort((a, b) => a.number - b.number);
      if (episodes.length === 0) {
        throw new Error("No se encontraron episodios en el HTML");
      }
      // Extraer título del anime
      const titleMatch = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
      const title = titleMatch ? titleMatch[1].trim() : "Anime sin título";
      return {
        id: null,
        title: title,
        description: "",
        image: null,
        genres: [],
        episodes: episodes,
        slug: new URL(url).pathname.split('/').pop() || "",
      };
    }

    // Si hay datos Svelte, procesar normalmente
    let media = null;
    for (const item of svelteData) {
      if (item?.title && item?.episodes) { media = item; break; }
    }
    if (!media) throw new Error("No se encontró información del anime");
    const episodes = (media.episodes || []).map((ep, index) => ({
      id: String(ep.number || ep.episode || index + 1),
      number: ep.number || ep.episode || index + 1,
      title: ep.title || `Episodio ${ep.number || index + 1}`,
      url: ep.url || `${url}/${ep.number || index + 1}`,
    })).filter(ep => ep.url);
    return {
      id: media.id || null,
      title: media.title,
      description: media.description || media.synopsis || "",
      image: media.poster || media.image || null,
      genres: media.genres || [],
      episodes,
      slug: media.slug || new URL(url).pathname.split('/').pop(),
    };
  } catch (error) {
    console.error("Error en getAnimeInfo:", error);
    return null;
  }
}

async function getEpisodeLinks(episodeUrl) {
  try {
    const html = await fetchHtml(episodeUrl);
    const svelteData = extractSvelteData(html);
    if (!svelteData) {
      // Fallback: buscar enlaces de video en el HTML
      console.log("[AnimeAV1] No se encontraron datos Svelte, buscando enlaces en HTML");
      const urlRegex = /https?:\/\/(?:www\.)?(?:pixeldrain\.com|mega\.nz|mp4upload\.com|1fichier\.com|player\.[^\s"'<>]+|[^\s"'<>]*zilla[^\s"'<>]*|[^\s"'<>]*uns\.bio[^\s"'<>]*)[^\s"'<>]*/gi;
      const found = html.match(urlRegex) || [];
      if (found.length > 0) {
        console.log("[AnimeAV1] Enlaces encontrados:", found);
        return found;
      }
      return [];
    }
    let episodeData = null;
    for (const item of svelteData) {
      if (item?.episode && (item?.streamLinks || item?.downloadLinks)) {
        episodeData = item;
        break;
      }
    }
    if (!episodeData) throw new Error("No se encontraron enlaces del episodio");
    const streamLinks = [];
    const addLinks = (links) => {
      if (!links) return;
      if (Array.isArray(links)) {
        for (const link of links) if (link?.url) streamLinks.push(link.url);
      } else if (typeof links === 'object') {
        for (const key of Object.keys(links)) {
          const value = links[key];
          if (Array.isArray(value)) {
            for (const link of value) if (link?.url) streamLinks.push(link.url);
          } else if (value?.url) streamLinks.push(value.url);
        }
      }
    };
    addLinks(episodeData.streamLinks?.SUB);
    addLinks(episodeData.streamLinks?.DUB);
    addLinks(episodeData.servers?.sub);
    addLinks(episodeData.servers?.dub);
    addLinks(episodeData.downloadLinks?.SUB);
    addLinks(episodeData.downloadLinks?.DUB);
    if (streamLinks.length === 0) {
      const urlRegex = /https?:\/\/(?:www\.)?(?:pixeldrain\.com|mega\.nz|mp4upload\.com|1fichier\.com|player\.[^\s"'<>]+|[^\s"'<>]*zilla[^\s"'<>]*|[^\s"'<>]*uns\.bio[^\s"'<>]*)[^\s"'<>]*/gi;
      const found = html.match(urlRegex) || [];
      for (const url of found) if (!streamLinks.includes(url)) streamLinks.push(url);
    }
    return streamLinks;
  } catch (error) {
    console.error("Error en getEpisodeLinks:", error);
    return [];
  }
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
    const results = await searchAnime(opts.query);
    return results.map(item => ({
      id: item.id,
      title: item.title,
      url: item.url,
      subOrDub: 'sub',
    }));
  }

  async findEpisodes(id) {
    this.currentSlug = id;
    const url = `https://${DEFAULT_DOMAIN}/media/${id}`;
    const info = await getAnimeInfo(url);
    if (!info) return [];
    return info.episodes.map(ep => ({
      id: ep.id,
      number: ep.number,
      url: ep.url,
      title: ep.title,
    }));
  }

  async findEpisodeServer(episode, server) {
    const episodeUrl = `https://${DEFAULT_DOMAIN}/media/${this.currentSlug}/${episode.id}`;
    const sources = await getEpisodeLinks(episodeUrl);
    if (sources.length === 0) {
      return { server: "AnimeAV1", headers: {}, videoSources: [] };
    }
    return {
      server: "AnimeAV1",
      headers: {},
      videoSources: sources.map(url => ({
        url: url,
        type: url.includes('.m3u8') ? 'm3u8' : 'mp4',
        quality: '1080p',
      })),
    };
  }
}

module.exports = { provider: Provider };
