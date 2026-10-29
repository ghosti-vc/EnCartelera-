// EnCartelera: próximos estrenos y títulos ya disponibles en plataformas de streaming.
// Los datos vienen de TMDB a través de kino.tmdb: Kino pone la clave, aquí no hay ninguna.

const IMG = "https://image.tmdb.org/t/p/";
const REGION = "MX";
const LANG = "es-MX";

// Plataformas que se muestran. "provider" es el id de TMDB para ver dónde está disponible
// un título; "network" es el id de la cadena, que sirve para las series que aún no salen.
// Para agregar o quitar una plataforma, edita esta lista.
const PLATFORMS = [
  { name: "Netflix", provider: 8, network: "213" },
  { name: "Prime Video", provider: 119, network: "1024" },
  { name: "Disney+", provider: 337, network: "2739" },
  { name: "Max", provider: 1899, network: "49|3186" },
  { name: "Apple TV+", provider: 350, network: "2552" },
  { name: "Paramount+", provider: 531, network: "4330" },
];

function t(es, en) {
  return kino.lang === "en-US" ? en : es;
}

function tabNames() {
  return [
    t("Estrenos: películas", "Upcoming: movies"),
    t("Estrenos: series", "Upcoming: shows"),
    t("Ya disponible", "Available now"),
  ];
}

function daysFrom(n) {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
}

// Llama a TMDB por kino.tmdb. Primero un await y después se valida (regla de Kino 0.9.49).
async function tmdb(path, params) {
  await null;
  if (typeof kino.tmdb !== "function") {
    throw kino.error("unavailable", "kino.tmdb no existe en esta versión de Kino", {
      userMessage: "Necesitas una versión más nueva de Kino para usar este plugin.",
    });
  }
  let r = await kino.tmdb(path, params);
  if (r && typeof r.json === "function") r = r.json();
  if (typeof r === "string") r = JSON.parse(r);
  return r || {};
}

async function discover(kind, params) {
  const base = { language: LANG, include_adult: "false", watch_region: REGION };
  const data = await tmdb("/discover/" + kind, Object.assign(base, params));
  return Array.isArray(data.results) ? data.results : [];
}

function toItem(x, kind) {
  const isMovie = kind === "movie";
  const date = isMovie ? x.release_date : x.first_air_date;
  const item = {
    id: (isMovie ? "m" : "s") + x.id,
    ref: (isMovie ? "movie:" : "tv:") + x.id,
    title: String((isMovie ? x.title : x.name) || ""),
    kind: isMovie ? "movie" : "series",
    ids: { tmdb: x.id },
  };
  if (x.poster_path) item.poster = IMG + "w342" + x.poster_path;
  if (x.backdrop_path) item.backdrop = IMG + "w780" + x.backdrop_path;
  if (date && date.length >= 4) item.year = Number(date.slice(0, 4));
  if (x.overview) item.overview = String(x.overview);
  return item;
}

function toItems(results, kind, max) {
  return (results || [])
    .filter((x) => x && x.id && (x.title || x.name))
    .slice(0, max || 40)
    .map((x) => toItem(x, kind));
}

// Parámetros de cada consulta
function upcomingMovies(provider) {
  return {
    with_watch_providers: String(provider),
    with_watch_monetization_types: "flatrate",
    "primary_release_date.gte": daysFrom(0),
    sort_by: "primary_release_date.asc",
  };
}

function upcomingSeries(network) {
  return {
    with_networks: network,
    "first_air_date.gte": daysFrom(0),
    sort_by: "first_air_date.asc",
  };
}

function availableMovies(provider) {
  return {
    with_watch_providers: String(provider),
    with_watch_monetization_types: "flatrate",
    "primary_release_date.gte": daysFrom(-60),
    "primary_release_date.lte": daysFrom(0),
    sort_by: "popularity.desc",
  };
}

function availableSeries(provider) {
  return {
    with_watch_providers: String(provider),
    with_watch_monetization_types: "flatrate",
    "first_air_date.gte": daysFrom(-90),
    "first_air_date.lte": daysFrom(0),
    sort_by: "popularity.desc",
  };
}

export async function home() {
  await null;
  const providers = PLATFORMS.map((p) => p.provider).join("|");
  const networks = PLATFORMS.map((p) => p.network).join("|");
  const jobs = [
    [t("Próximos estrenos: películas", "Upcoming movies"), "peliculas", "movie",
      () => discover("movie", upcomingMovies(providers))],
    [t("Próximos estrenos: series", "Upcoming shows"), "series", "tv",
      () => discover("tv", upcomingSeries(networks))],
    [t("Ya disponible: películas", "Available now: movies"), "peliculas", "movie",
      () => discover("movie", availableMovies(providers))],
    [t("Ya disponible: series", "Available now: shows"), "series", "tv",
      () => discover("tv", availableSeries(providers))],
  ];
  let lastError = null;
  const rows = await Promise.all(
    jobs.map(async (job) => {
      try {
        const results = await job[3]();
        const items = toItems(results, job[2] === "movie" ? "movie" : "tv");
        return items.length ? { title: job[0], genre: job[1], items } : null;
      } catch (e) {
        lastError = e;
        console.log("home: falló una fila", e && e.message);
        return null;
      }
    })
  );
  const ok = rows.filter(Boolean);
  if (!ok.length && lastError) throw lastError;
  return ok;
}

// Una fila por plataforma dentro de cada pestaña de la sección propia
export async function section(arg) {
  await null;
  const tabs = tabNames();
  const tab = arg && tabs.indexOf(arg.tab) >= 0 ? arg.tab : tabs[0];
  const index = tabs.indexOf(tab);
  let lastError = null;
  const rows = await Promise.all(
    PLATFORMS.map(async (p) => {
      try {
        let items = [];
        if (index === 0) {
          items = toItems(await discover("movie", upcomingMovies(p.provider)), "movie");
        } else if (index === 1) {
          items = toItems(await discover("tv", upcomingSeries(p.network)), "tv");
        } else {
          const both = await Promise.all([
            discover("movie", availableMovies(p.provider)),
            discover("tv", availableSeries(p.provider)),
          ]);
          const merged = both[0]
            .map((x) => ({ x, kind: "movie" }))
            .concat(both[1].map((x) => ({ x, kind: "tv" })))
            .sort((a, b) => (b.x.popularity || 0) - (a.x.popularity || 0))
            .slice(0, 30);
          items = merged
            .filter((m) => m.x && m.x.id && (m.x.title || m.x.name))
            .map((m) => toItem(m.x, m.kind));
        }
        return items.length ? { title: p.name, items } : null;
      } catch (e) {
        lastError = e;
        console.log("section: falló " + p.name, e && e.message);
        return null;
      }
    })
  );
  const ok = rows.filter(Boolean);
  if (!ok.length && lastError) throw lastError;
  return { tabs, tab, rows: ok };
}

// Un catálogo sin video: las series no listan capítulos.
export async function episodes(ref) {
  await null;
  return [];
}

export async function resolve(ref) {
  await null;
  throw kino.error("not_found", "catálogo sin video", {
    userMessage: "EnCartelera solo muestra estrenos y no reproduce nada.",
  });
}
