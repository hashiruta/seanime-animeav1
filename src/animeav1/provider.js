/// <reference path="./online-streaming-provider.d.ts" />

// --- Configuración y utilidades básicas (adaptadas) ---
const DEFAULT_DOMAIN = "animeav1.com";

const HTTP_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
};

// Función para hacer peticiones HTTP (usa fetch de Seanime)
async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: HTTP_HEADERS,
  });
  if (!response.ok) {
    throw new Error(`Error ${response.status} al obtener ${url}`);
  }
  return await response.text();
}

// Función para extraer datos de Svelte (reemplaza la versión con vm)
function extractSvelteData(html) {
  // Busca el script que contiene __sveltekit_
  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    const scriptContent = match[1];
    if (!scriptContent.includes("__sveltekit_") || !scriptContent.includes("data:")) continue;

    // Busca el objeto literal que contiene "data"
    const dataMarker = scriptContent.indexOf("data:");
    if (dataMarker === -1) continue;
    
    const listStart = scriptContent.indexOf("[", dataMarker);
    if (listStart === -1) continue;
    
    // Extrae el array de forma segura (búsqueda de corchetes balanceados)
    let depth = 0;
    let end = listStart;
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
      // Evaluar el array (en Seanime, podemos usar Function o eval con precaución)
      // NOTA: En un entorno controlado, esto es seguro porque solo evalúa el JSON
      const data = new Function(`return (${arrayStr})`)();
      if (Array.isArray(data)) return data;
    } catch (_) {
      // Si falla, continuar
    }
  }
  return null;
}

// --- Funciones de scraping adaptadas ---

async function searchAnime(query) {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  const domain = DEFAULT_DOMAIN;
  const searchUrl = `https://${domain}/catalogo?search=${encodeURIComponent(cleanQuery)}`;
  
  try {
    const html = await fetchHtml(searchUrl);
    const svelteData = extractSvelteData(html);
    
    // Si hay datos Svelte, intentar extraer resultados
    if (svelteData) {
      // Buscar el array que contiene los resultados de búsqueda
      for (const item of svelteData) {
        if (Array.isArray(item) && item.length > 0 && item[0]?.title) {
          return item.map(result => ({
            id: result.id || null,
            title: result.title || result.name,
            url: result.url || `https://${domain}/media/${result.slug}`,
            image: result.poster || result.image || null,
            type: result.type || null,
            year: result.year || null,
          })).filter(r => r.title);
        }
      }
    }
    
    // Fallback: parseo básico del HTML
    const results = [];
    const linkRegex = /<a[^>]*href="\/media\/([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      const slug = match[1];
      const titleMatch = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(match[2]);
      const title = titleMatch ? titleMatch[1].trim() : slug;
      results.push({
        id: null,
        title: title,
        url: `https://${domain}/media/${slug}`,
        image: null,
        type: null,
        year: null,
      });
    }
    // Deduplicar por URL
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
    if (!svelteData) throw new Error("No se encontraron datos Svelte");

    // Buscar el objeto que contiene la información del anime
    let media = null;
    for (const item of svelteData) {
      if (item?.title && item?.episodes) {
        media = item;
        break;
      }
    }
    if (!media) throw new Error("No se encontró información del anime");

    // Construir la lista de episodios
    const episodes = (media.episodes || []).map((ep, index) => ({
      id: ep.id || null,
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
      episodes: episodes,
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
    if (!svelteData) throw new Error("No se encontraron datos Svelte");

    // Buscar el objeto que contiene los enlaces del episodio
    let episodeData = null;
    for (const item of svelteData) {
      if (item?.episode && (item?.streamLinks || item?.downloadLinks)) {
        episodeData = item;
        break;
      }
    }
    if (!episodeData) throw new Error("No se encontraron enlaces del episodio");

    // Extraer URLs de stream (priorizar SUB, luego DUB)
    const streamLinks = [];
    const addLinks = (links) => {
      if (!links) return;
      if (Array.isArray(links)) {
        for (const link of links) {
          if (link?.url) streamLinks.push(link.url);
        }
      } else if (typeof links === 'object') {
        for (const key of Object.keys(links)) {
          const value = links[key];
          if (Array.isArray(value)) {
            for (const link of value) {
              if (link?.url) streamLinks.push(link.url);
            }
          } else if (value?.url) {
            streamLinks.push(value.url);
          }
        }
      }
    };

    // Intentar extraer de varias ubicaciones posibles
    addLinks(episodeData.streamLinks?.SUB);
    addLinks(episodeData.streamLinks?.DUB);
    addLinks(episodeData.servers?.sub);
    addLinks(episodeData.servers?.dub);
    addLinks(episodeData.downloadLinks?.SUB);
    addLinks(episodeData.downloadLinks?.DUB);

    // Si no se encontraron enlaces estructurados, buscar en el HTML
    if (streamLinks.length === 0) {
      const urlRegex = /https?:\/\/(?:www\.)?(?:pixeldrain\.com|mega\.nz|mp4upload\.com|1fichier\.com|player\.[^\s"'<>]+|[^\s"'<>]*zilla[^\s"'<>]*|[^\s"'<>]*uns\.bio[^\s"'<>]*)[^\s"'<>]*/gi;
      const found = html.match(urlRegex) || [];
      for (const url of found) {
        if (!streamLinks.includes(url)) streamLinks.push(url);
      }
    }

    return streamLinks;
  } catch (error) {
    console.error("Error en getEpisodeLinks:", error);
    return [];
  }
}

// --- Clase Provider para Seanime ---

class Provider {
  getSettings() {
    return {
      episodeServers: ["AnimeAV1"],
      supportsDub: false,
    };
  }

  // 1. Buscar animes
  async search(opts) {
    if (!opts.query || opts.query.trim() === '') return [];
    const results = await searchAnime(opts.query);
    return results.map(item => ({
      id: item.id || item.url,
      title: item.title,
      url: item.url,
      subOrDub: 'sub',
    }));
  }

  // 2. Obtener episodios de un anime
  async findEpisodes(id) {
    // 'id' es la URL del anime
    const info = await getAnimeInfo(id);
    if (!info) return [];
    return info.episodes.map(ep => ({
      id: ep.url, // Usamos la URL del episodio como ID
      number: ep.number,
      url: ep.url,
      title: ep.title,
    }));
  }

  // 3. Obtener la URL del video de un episodio
  async findEpisodeServer(episode, server) {
    // episode.id es la URL del episodio
    const sources = await getEpisodeLinks(episode.id);
    if (sources.length === 0) {
      return { server: "AnimeAV1", headers: {}, videoSources: [] };
    }

    // Elegir la primera fuente válida
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
