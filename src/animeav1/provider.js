/// <reference path="./online-streaming-provider.d.ts" />

class Provider {
    // Configuración inicial de la extensión
    getSettings() {
        return {
            episodeServers: ["AnimeAV1"],
            supportsDub: false, // AnimeAV1 tiene subs en español
        };
    }

    // 1. Buscar animes
    async search(opts) {
        // Aquí irá la lógica para buscar en AnimeAV1 usando la API de anime1v-api
        // Debe devolver un array como: [{ id: "123", title: "Shingeki no Kyojin", url: "...", subOrDub: "sub" }]
        return [];
    }

    // 2. Obtener episodios de un anime
    async findEpisodes(id) {
        // Aquí irá la lógica para obtener los episodios del anime con ID 'id'
        // Debe devolver un array como: [{ id: "ep1", number: 1, url: "..." }]
        return [];
    }

    // 3. Obtener la URL del video de un episodio
    async findEpisodeServer(episode, server) {
        // Aquí irá la lógica para obtener el enlace directo al video del episodio
        // Debe devolver un objeto como: { server: "...", headers: {}, videoSources: [{ url: "...", type: "m3u8", quality: "1080p" }] }
        return { server: "AnimeAV1", headers: {}, videoSources: [] };
    }
}

// Exportar el proveedor (importante)
module.exports = { provider: Provider };
