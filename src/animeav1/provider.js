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
  console.log("[AnimeAV1] 🔍 Fetching:", url);
  const response = await fetch(url, { headers: HTTP_HEADERS });
  if (!response.ok) {
    throw new Error(`Error ${response.status} al obtener ${url}`);
  }
  const html = await response.text();
  console.log(`[AnimeAV1] 📄 HTML recibido, longitud: ${html.length} caracteres`);
  // Mostrar los primeros 300 caracteres para identificar la estructura
  console.log("[AnimeAV1] 📄 Preview HTML:", html.substring(0, 300));
  return html;
}

function extractEpisodesFromHtml(html, baseUrl) {
  console.log("[AnimeAV1] 🔎 Extrayendo episodios del HTML...");
  const episodes = [];
  const regex = /href="\/media\/([^\/]+)\/(\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  let count = 0;
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
    count++;
  }
  console.log(`[AnimeAV1] 🔎 Encontrados ${count} episodios con el patrón principal.`);

  // Fallback si no encontró nada
  if (episodes.length === 0) {
    console.log("[AnimeAV1] ⚠️ No se encontraron episodios con el patrón principal, usando fallback...");
    const altRegex = /href="\/media\/[^\/]+\/(\d+)"/gi;
    let altMatch;
    const seen = new Set();
    let fallbackCount = 0;
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
        fallbackCount++;
      }
    }
    console.log(`[AnimeAV1] 🔎 Fallback: encontrados ${fallbackCount} episodios adicionales.`);
  }

  episodes.sort((a, b) => a.number - b.number);
  console.log(`[AnimeAV1] ✅ Total episodios extraídos: ${episodes.length}`);
  return episodes;
}

function extractVideoLinks(html, url) {
  console.log("[AnimeAV1] 🎬 Extrayendo enlaces de video del HTML...");

  // 1. Buscar enlaces en atributos src, href, data-src, etc.
  const attrRegex = /(?:src|href|data-src|data-href)=["']([^"']*\.(?:m3u8|mp4|webm|mkv|avi|embed|player|pixeldrain|mega|mp4upload|1fichier|zilla|uns\.bio)[^"']*)["']/gi;
  let match;
  const found = [];
  while ((match = attrRegex.exec(html)) !== null) {
    let videoUrl = match[1];
    if (!videoUrl.startsWith('http://') && !videoUrl.startsWith('https://')) {
      // Si es relativa, intentar completar con la URL base
      try {
        const base = new URL(url);
        videoUrl = new URL(videoUrl, base.origin).toString();
      } catch (_) {
        continue;
      }
    }
    if (videoUrl) {
      found.push(videoUrl);
    }
  }

  // 2. Si no encontró, buscar cualquier URL que parezca un stream con regex general
  if (found.length === 0) {
    console.log("[AnimeAV1] ⚠️ No se encontraron enlaces en atributos, usando regex general...");
    const generalRegex = /https?:\/\/(?:www\.)?(?:pixeldrain\.com|mega\.nz|mp4upload\.com|1fichier\.com|player\.[^\s"'<>]+|[^\s"'<>]*zilla[^\s"'<>]*|[^\s"'<>]*uns\.bio[^\s"'<>]*)[^\s"'<>]*/gi;
    const generalUrls = html.match(generalRegex) || [];
    generalUrls.forEach(u => {
      if (!found.includes(u)) found.push(u);
    });
  }

  // 3. Si sigue sin encontrar, buscar en scripts
  if (found.length === 0) {
    console.log("[AnimeAV1] ⚠️ No se encontraron enlaces con regex general, buscando en scripts...");
    const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    let scriptMatch;
    const scriptUrls = [];
    while ((scriptMatch = scriptRegex.exec(html)) !== null) {
      const scriptContent = scriptMatch[1];
      const urls = scriptContent.match(/https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4|embed|player|pixeldrain|mega|mp4upload|1fichier|zilla|uns\.bio)[^\s"'<>]*/gi) || [];
      scriptUrls.push(...urls);
    }
    scriptUrls.forEach(u => {
      if (!found.includes(u)) found.push(u);
    });
  }

  // 4. Último recurso: mostrar un aviso
  if (found.length === 0) {
    console.log("[AnimeAV1] ❌ No se encontraron enlaces de video en el HTML.");
  } else {
    console.log(`[AnimeAV1] ✅ Enlaces de video encontrados: ${found.length}`);
    found.forEach((u, i) => console.log(`  ${i+1}. ${u}`));
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
      console.log("[AnimeAV1] 🔍 Buscando:", opts.query);
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
      console.log(`[AnimeAV1] ✅ Resultados de búsqueda: ${results.length}`);
      return results.slice(0, 20);
    } catch (error) {
      console.error("[AnimeAV1] ❌ Error en search:", error);
      return [];
    }
  }

  async findEpisodes(id) {
    console.log(`[AnimeAV1] 📺 Buscando episodios para: ${id}`);
    this.currentSlug = id;
    try {
      const url = `https://${DEFAULT_DOMAIN}/media/${id}`;
      const html = await fetchHtml(url);
      const episodes = extractEpisodesFromHtml(html, url);
      console.log(`[AnimeAV1] ✅ Episodios encontrados: ${episodes.length}`);
      return episodes.map(ep => ({
        id: ep.id,
        number: ep.number,
        url: ep.url,
        title: ep.title,
      }));
    } catch (error) {
      console.error("[AnimeAV1] ❌ Error en findEpisodes:", error);
      return [];
    }
  }

  async findEpisodeServer(episode, server) {
    console.log(`[AnimeAV1] 🎬 Buscando servidor para episodio:`, episode);
    console.log(`[AnimeAV1] 🎬 Slug actual: ${this.currentSlug}`);
    try {
      const episodeUrl = `https://${DEFAULT_DOMAIN}/media/${this.currentSlug}/${episode.id}`;
      console.log(`[AnimeAV1] 🎬 URL del episodio: ${episodeUrl}`);
      const html = await fetchHtml(episodeUrl);
      const videoUrls = extractVideoLinks(html, episodeUrl);

      if (videoUrls.length === 0) {
        console.log("[AnimeAV1] ⚠️ No se encontraron URLs de video, devolviendo videoSources vacío.");
        return { server: "AnimeAV1", headers: {}, videoSources: [] };
      }

      // Construir videoSources a partir de los enlaces encontrados
      const videoSources = videoUrls.map(url => ({
        url: url,
        type: url.includes('.m3u8') ? 'm3u8' : 'mp4',
        quality: '1080p',
      }));

      console.log(`[AnimeAV1] ✅ Devolviendo ${videoSources.length} fuentes de video.`);
      return {
        server: "AnimeAV1",
        headers: {},
        videoSources: videoSources,
      };
    } catch (error) {
      console.error("[AnimeAV1] ❌ Error en findEpisodeServer:", error);
      return { server: "AnimeAV1", headers: {}, videoSources: [] };
    }
  }
}

// Para el repositorio: descomenta esta línea
module.exports = { provider: Provider };
