// EnCartelera: próximos estrenos y títulos ya disponibles en plataformas de streaming.
// Los datos vienen de TMDB a través de kino.tmdb: Kino pone la clave, aquí no hay ninguna.

const IMG = "https://image.tmdb.org/t/p/";
const REGION = "MX";
const LANG = "es-MX";

// Una pestaña por plataforma (máximo 7, porque Kino permite 8 pestañas y la última es "Ya disponible").
// "id"       = identificador de la pestaña (solo letras, números y guiones).
// "provider" = id de TMDB para saber dónde está disponible un título.
// "network"  = id de la cadena, sirve para las series que aún no salen.
// "region"   = país donde se consulta (Hulu solo existe en EE. UU.).
// Para agregar o quitar una plataforma, edita esta lista.
const PLATFORMS = [
  { id: "netflix", name: "Netflix", provider: "8", network: "213" },
  { id: "hbo-max", name: "HBO Max", provider: "1899|384", network: "49|3186" },
  { id: "disney", name: "Disney+", provider: "337", network: "2739" },
  { id: "prime", name: "Prime Video", provider: "119", network: "1024" },
  { id: "hulu", name: "Hulu", provider: "15", network: "453", region: "US" },
  { id: "apple", name: "Apple TV+", provider: "350", network: "2552" },
  { id: "paramount", name: "Paramount+", provider: "531", network: "4330" },
];

const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function t(es, en) {
  return kino.lang === "en-US" ? en : es;
}

function tabList() {
  return PLATFORMS.map((p) => ({ id: p.id, label: p.name })).concat([
    { id: "disponible", label: t("Ya disponible", "Available now") },
  ]);
}

function daysFrom(n) {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
}

// "2026-12-18" -> "18 dic 2026"
function niceDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  if (!m) return "";
  const names = kino.lang === "en-US" ? MONTHS_EN : MONTHS_ES;
  return Number(m[3]) + " " + names[Number(m[2]) - 1] + " " + m[1];
}

// Llama a TMDB por kino.tmdb (la ruta empieza con "/discover", sin versión ni parámetros).
// Primero un await y después se valida (regla de Kino 0.9.49).
async function tmdb(path, params) {
  await null;
  if (typeof kino.tmdb !== "function") {
    throw kino.error("unavailable", "kino.tmdb no existe en esta versión de Kino", {
      userMessage: "Necesitas una versión más nueva de Kino para usar este plugin.",
    });
  }
  const data = await kino.tmdb(path, params);
  console.log("tmdb " + path, "resultados:", data && Array.isArray(data.results) ? data.results.length : "ninguno");
  return data || {};
}

async function discover(kind, params, region) {
  const base = { language: LANG, include_adult: "false", watch_region: region || REGION };
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
  if (x.vote_average > 0) item.rating = Math.round(x.vote_average * 10) / 10;
  const when = niceDate(date);
  if (when) item.badges = [when];
  return item;
}

function toItems(results, kind, max) {
  return (results || [])
    .filter((x) => x && x.id && (x.title || x.name))
    .slice(0, max || 40)
    .map((x) => toItem(x, kind));
}

// Parámetros de cada consulta (p = una plataforma de la lista)
function upcomingMovies(p) {
  return {
    with_watch_providers: p.provider,
    with_watch_monetization_types: "flatrate",
    "primary_release_date.gte": daysFrom(0),
    sort_by: "primary_release_date.asc",
  };
}

function upcomingSeries(p) {
  return {
    with_networks: p.network,
    "first_air_date.gte": daysFrom(0),
    sort_by: "first_air_date.asc",
  };
}

function availableMovies(p) {
  return {
    with_watch_providers: p.provider,
    with_watch_monetization_types: "flatrate",
    "primary_release_date.gte": daysFrom(-60),
    "primary_release_date.lte": daysFrom(0),
    sort_by: "popularity.desc",
  };
}

function availableSeries(p) {
  return {
    with_watch_providers: p.provider,
    with_watch_monetization_types: "flatrate",
    "first_air_date.gte": daysFrom(-90),
    "first_air_date.lte": daysFrom(0),
    sort_by: "popularity.desc",
  };
}

// Corre varias consultas a la vez y arma una fila con cada una; las que fallan se omiten.
// Cada fila lleva su "id" (Kino descarta las filas sin él).
async function buildRows(jobs) {
  let lastError = null;
  const rows = await Promise.all(
    jobs.map(async (job) => {
      try {
        const results = await job.load();
        const items = toItems(results, job.kind);
        if (!items.length) return null;
        const row = { id: job.id, title: job.title, items };
        if (job.genre) row.genre = job.genre;
        return row;
      } catch (e) {
        lastError = e;
        console.log("falló una fila:", job.id, e && e.message);
        return null;
      }
    })
  );
  const ok = rows.filter(Boolean);
  if (!ok.length && lastError) throw lastError;
  if (!ok.length) {
    throw kino.error("unavailable", "TMDB no devolvió resultados", {
      userMessage: "No encontré estrenos por ahora. Intenta de nuevo en unos minutos.",
    });
  }
  return ok;
}

// Inicio de Kino: cuatro filas con todas las plataformas juntas
export async function home() {
  await null;
  const all = {
    provider: PLATFORMS.map((p) => p.provider).join("|"),
    network: PLATFORMS.map((p) => p.network).join("|"),
  };
  return buildRows([
    { id: "home-up-movies", title: t("Próximos estrenos: películas", "Upcoming movies"), genre: "peliculas", kind: "movie",
      load: () => discover("movie", upcomingMovies(all)) },
    { id: "home-up-series", title: t("Próximos estrenos: series", "Upcoming shows"), genre: "series", kind: "tv",
      load: () => discover("tv", upcomingSeries(all)) },
    { id: "home-now-movies", title: t("Ya disponible: películas", "Available now: movies"), genre: "peliculas", kind: "movie",
      load: () => discover("movie", availableMovies(all)) },
    { id: "home-now-series", title: t("Ya disponible: series", "Available now: shows"), genre: "series", kind: "tv",
      load: () => discover("tv", availableSeries(all)) },
  ]);
}

// Sección propia: una pestaña por plataforma (con sus próximos estrenos de películas y de series)
// y una última pestaña "Ya disponible". Kino manda { tab: null } la primera vez.
export async function section(arg) {
  await null;
  const tabs = tabList();
  const wanted = arg && arg.tab;
  const current = tabs.filter((x) => x.id === wanted)[0] || tabs[0];
  const index = tabs.indexOf(current);
  let jobs = [];
  if (index < PLATFORMS.length) {
    const p = PLATFORMS[index];
    jobs = [
      { id: p.id + "-up-movies", title: t("Próximos estrenos: películas", "Upcoming movies"), kind: "movie",
        load: () => discover("movie", upcomingMovies(p), p.region) },
      { id: p.id + "-up-series", title: t("Próximos estrenos: series", "Upcoming shows"), kind: "tv",
        load: () => discover("tv", upcomingSeries(p), p.region) },
    ];
  } else {
    PLATFORMS.forEach((p) => {
      jobs.push({ id: "now-" + p.id + "-movies", title: p.name + ": " + t("películas", "movies"), kind: "movie",
        load: () => discover("movie", availableMovies(p), p.region) });
      jobs.push({ id: "now-" + p.id + "-series", title: p.name + ": " + t("series", "shows"), kind: "tv",
        load: () => discover("tv", availableSeries(p), p.region) });
    });
  }
  const rows = await buildRows(jobs);
  return { tabs, tab: current.id, rows };
}

// Un catálogo sin video: las series no listan capítulos.
export async function episodes(ref) {
  await null;
  return { episodes: [] };
}

export async function resolve(ref) {
  await null;
  throw kino.error("not_found", "catálogo sin video", {
    userMessage: "EnCartelera solo muestra estrenos y no reproduce nada.",
  });
}
