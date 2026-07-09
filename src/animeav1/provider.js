
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

// Extrae la lista de episodios de la página del anime (como antes)
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

// Función de filtrado mejorada
function isLikelyVideoUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (trimmed === '') return false;

  // Descarta enlaces que son páginas HTML del sitio (otros episodios, etc.)
  if (trimmed.includes('/media/') && !/\.(m3u8|mp4|webm|mkv|avi|mov|flv|wmv)$/i.test(trimmed)) {
    return false;
  }

  // Descarta recursos estáticos (CSS, JS, fuentes, imágenes)
  if (/\.(css|js|woff2?|ttf|svg|png|jpg|jpeg|gif|ico)(\?|$)/i.test(trimmed)) {
    return false;
  }

  // Extensiones de video directas
  if (/\.(m3u8|mp4|webm|mkv|avi|mov|flv|wmv)$/i.test(trimmed)) {
    return true;
  }

  // Dominios de servicios de video conocidos
  if (/(pixeldrain|mega\.nz|mp4upload|1fichier|streamwish|streamtape|voe|vidhide|hqq|filemoon|okru|fembed|uns\.bio|zilla-networks|player\.)/i.test(trimmed)) {
    return true;
  }

  // Palabras clave de video, pero con filtros extra
  if (/(video|stream|embed|play|file|watch|download)/i.test(trimmed) &&
      !trimmed.includes('googletagmanager') &&
      !trimmed.includes('cloudflare') &&
      !trimmed.includes('analytics') &&
      !trimmed.includes('beacon')) {
    return true;
  }

  return false;
}

// Extrae enlaces de video mejorado
function extractVideoLinks(html, url) {
  const found = [];

  // 1. Atributos específicos de fuentes de video
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
    if (videoUrl && isLikelyVideoUrl(videoUrl) && !found.includes(videoUrl)) {
      found.push(videoUrl);
    }
  }

  // 2. Buscar en scripts (patrones de configuración de reproductores)
  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let scriptMatch;
  while ((scriptMatch = scriptRegex.exec(html)) !== null) {
    const scriptContent = scriptMatch[1];
    const scriptUrls = scriptContent.match(/https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4|embed|player|pixeldrain|mega|mp4upload|1fichier|zilla|uns\.bio|streamwish|streamtape|voe|vidhide|hqq|filemoon|okru|fembed)[^\s"'<>]*/gi) || [];
    scriptUrls.forEach(u => {
      if (isLikelyVideoUrl(u) && !found.includes(u)) found.push(u);
    });
  }

  // 3. Enlaces de descarga directa (etiquetas <a> con texto "Descargar")
  const downloadRegex = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>[\s\S]*?(?:Descargar|download)[\s\S]*?<\/a>/gi;
  let downloadMatch;
  while ((downloadMatch = downloadRegex.exec(html)) !== null) {
    const urlCandidate = downloadMatch[1];
    if (urlCandidate && isLikelyVideoUrl(urlCandidate) && !found.includes(urlCandidate)) {
      found.push(urlCandidate);
    }
  }

  // 4. Buscar URLs de video en el HTML general (solo aquellas con extensión de video o dominios conocidos)
  const generalRegex = /https?:\/\/(?:www\.)?(?:pixeldrain\.com|mega\.nz|mp4upload\.com|1fichier\.com|player\.[^\s"'<>]+|[^\s"'<>]*zilla[^\s"'<>]*|[^\s"'<>]*uns\.bio[^\s"'<>]*|streamwish|streamtape|voe|vidhide|hqq|filemoon|okru|fembed)[^\s"'<>]*\.(?:m3u8|mp4|webm|mkv|avi|embed|play|file)/gi;
  const generalUrls = html.match(generalRegex) || [];
  generalUrls.forEach(u => {
    if (isLikelyVideoUrl(u) && !found.includes(u)) found.push(u);
  });

  // Eliminar duplicados y devolver
  return [...new Set(found)];
}

// Resolvedores para MP4Upload y Mega (igual que antes)
async function resolveMP4Upload(embedUrl) {
  try {
    const html = await fetchHtml(embedUrl);
    const match = html.match(/src:\s*['"](https?:\/\/[^'"]+\.mp4[^'"]*)['"]/i) ||
                  html.match(/<video[^>]*src="([^"]+\.mp4)"/i) ||
                  html.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/i);
    if (match && match[1]) {
      return match[1];
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function resolveMega(embedUrl) {
  try {
    const match = embedUrl.match(/mega\.nz\/embed\/([^#]+)/);
    if (match && match[1]) {
      return `https://mega.nz/file/${match[1]}`;
    }
    return embedUrl;
  } catch {
    return embedUrl;
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
      let videoUrls = extractVideoLinks(html, episodeUrl);

      // Resolver MP4Upload y Mega
      const resolvedUrls = [];
      for (const url of videoUrls) {
        let resolved = url;
        if (url.includes('mp4upload.com/embed-')) {
          const mp4 = await resolveMP4Upload(url);
          if (mp4) resolved = mp4;
        } else if (url.includes('mega.nz/embed/')) {
          resolved = await resolveMega(url);
        }
        if (resolved && isLikelyVideoUrl(resolved) && !resolvedUrls.includes(resolved)) {
          resolvedUrls.push(resolved);
        }
      }

      if (resolvedUrls.length === 0) {
        return { server: "AnimeAV1", headers: {}, videoSources: [] };
      }

      // Priorizar enlaces directos (con extensión .mp4 o .m3u8)
      resolvedUrls.sort((a, b) => {
        const aExt = /\.(mp4|m3u8)$/i.test(a);
        const bExt = /\.(mp4|m3u8)$/i.test(b);
        if (aExt && !bExt) return -1;
        if (!aExt && bExt) return 1;
        return 0;
      });

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
