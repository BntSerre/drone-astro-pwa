// ============================================================================
// DroneAstro Assistant — Application PWA Dark Mode
// Assistant de terrain pour DJI Neo 2 & Astrophotographie
// ============================================================================

'use strict';

// ── 1. CONFIGURATION & SEUILS MÉTIER ─────────────────────────────────────────
const CONFIG = {
  // Coordonnées de test par défaut (ex: 45.23, 0.59 - Nouvelle-Aquitaine)
  DEFAULT_LAT: 45.23,
  DEFAULT_LON: 0.59,

  // Seuils Vol Drone (calibré pour drone ultraléger type DJI Neo 2)
  DRONE: {
    WIND_GO: 20,       // < 20 km/h -> GO
    WIND_WARN: 28,     // 20 - 28 km/h -> PRUDENCE, > 28 -> NO-GO
    GUST_GO: 25,       // < 25 km/h -> GO
    GUST_WARN: 32,     // 25 - 32 km/h -> PRUDENCE, > 32 -> NO-GO
    KP_GO: 4,          // < 4 -> GO, == 4 -> PRUDENCE, >= 5 -> NO-GO
    KP_DANGER: 5
  },

  // Seuils Photo de nuit & Astro
  ASTRO: {
    CLOUD_GO: 15,      // < 15% -> GO, 15 - 40% -> PRUDENCE, > 40% -> NO-GO
    CLOUD_WARN: 40,
    MOON_GO: 25,       // < 25% -> GO, 25 - 50% -> PRUDENCE, > 50% -> NO-GO
    MOON_WARN: 50
  },

  REFRESH_INTERVAL: 300000, // 5 minutes en ms
  OPEN_METEO_URL: 'https://api.open-meteo.com/v1/forecast',
  NOAA_KP_URL: 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json',
  NOMINATIM_SEARCH_URL: 'https://nominatim.openstreetmap.org/search',
  NOMINATIM_REVERSE_URL: 'https://nominatim.openstreetmap.org/reverse'
};

// ── 2. ÉTAT DE L'APPLICATION ────────────────────────────────────────────────
const state = {
  lat: null,
  lon: null,
  locationName: 'Localisation...',
  weather: null,
  kpIndex: null,
  kpData: [],
  ephemeris: null,
  moonData: null,
  droneStatus: null,
  astroStatus: null,
  lastUpdate: null
};

// Instances Leaflet et Chart.js
let leafletMap = null;
let leafletMarker = null;
let forecastChart = null;

// ── 3. GÉOLOCALISATION & RECHERCHE DE LIEU ──────────────────────────────────

/**
 * Initialise la géolocalisation de l'utilisateur.
 * Utilise l'API navigator.geolocation avec fallback sur les coordonnées par défaut.
 */
function initGeolocation() {
  if (!navigator.geolocation) {
    console.warn('[DroneAstro] Géolocalisation non supportée, utilisation du repli.');
    applyLocation(CONFIG.DEFAULT_LAT, CONFIG.DEFAULT_LON);
    return;
  }

  // Timeout de 6 secondes pour basculer rapidement si refusé ou lent
  const geoTimeout = setTimeout(() => {
    if (state.lat === null) {
      console.warn('[DroneAstro] Timeout GPS, utilisation du lieu par défaut.');
      applyLocation(CONFIG.DEFAULT_LAT, CONFIG.DEFAULT_LON);
    }
  }, 6000);

  navigator.geolocation.getCurrentPosition(
    (position) => {
      clearTimeout(geoTimeout);
      applyLocation(position.coords.latitude, position.coords.longitude);
    },
    (err) => {
      clearTimeout(geoTimeout);
      console.warn('[DroneAstro] Erreur GPS:', err.message, '-> Fallback par défaut.');
      applyLocation(CONFIG.DEFAULT_LAT, CONFIG.DEFAULT_LON);
    },
    { enableHighAccuracy: true, timeout: 6000, maximumAge: 60000 }
  );
}

/**
 * Applique une position et déclenche le rafraîchissement.
 */
async function applyLocation(lat, lon, explicitName = null) {
  state.lat = Number(lat.toFixed(4));
  state.lon = Number(lon.toFixed(4));

  if (explicitName) {
    state.locationName = explicitName;
    updateLocationDisplay();
  } else {
    // Géocodage inverse asynchrone sans bloquer l'affichage météo
    reverseGeocode(state.lat, state.lon);
  }

  updateMapPosition(state.lat, state.lon);
  await refreshAllData();
}

/**
 * Géocodage inverse via Nominatim OpenStreetMap.
 */
async function reverseGeocode(lat, lon) {
  try {
    const url = `${CONFIG.NOMINATIM_REVERSE_URL}?format=json&lat=${lat}&lon=${lon}&zoom=12`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const city = data.address?.city || data.address?.town || data.address?.village || data.address?.municipality || '';
    const dept = data.address?.county || data.address?.state || '';
    state.locationName = city ? `${city}${dept ? ' (' + dept + ')' : ''}` : (data.display_name?.split(',')[0] || `${lat}, ${lon}`);
  } catch (e) {
    state.locationName = `${lat}°N, ${lon}°E`;
  }
  updateLocationDisplay();
}

/**
 * Met à jour l'en-tête de position dans le DOM.
 */
function updateLocationDisplay() {
  const nameEl = document.getElementById('location-name');
  const coordsEl = document.getElementById('location-coords');
  if (nameEl) nameEl.textContent = state.locationName;
  if (coordsEl) coordsEl.textContent = `${state.lat}°N, ${state.lon}°E`;
}

/**
 * Configuration de la recherche d'adresse manuelle.
 */
function setupSearchListeners() {
  const input = document.getElementById('location-search');
  const btn = document.getElementById('btn-search');
  const resultsBox = document.getElementById('search-results');

  if (!input || !resultsBox) return;

  const doSearch = async () => {
    const q = input.value.trim();
    if (q.length < 2) return;

    try {
      const url = `${CONFIG.NOMINATIM_SEARCH_URL}?format=json&q=${encodeURIComponent(q)}&limit=5&countrycodes=fr`;
      const res = await fetch(url);
      const items = await res.json();

      if (!items || items.length === 0) {
        resultsBox.innerHTML = '<div class="search-result-item" style="color:var(--text-dim);">Aucun résultat trouvé</div>';
        resultsBox.hidden = false;
        return;
      }

      resultsBox.innerHTML = items.map((item, idx) => `
        <div class="search-result-item" data-idx="${idx}">
          <strong>${item.display_name.split(',')[0]}</strong>
          <span style="font-size:0.75rem; color:var(--text-muted); display:block;">${item.display_name.split(',').slice(1, 3).join(',')}</span>
        </div>
      `).join('');
      resultsBox.hidden = false;

      resultsBox.querySelectorAll('.search-result-item').forEach((elem) => {
        elem.addEventListener('click', () => {
          const idx = elem.dataset.idx;
          const chosen = items[idx];
          if (chosen) {
            resultsBox.hidden = true;
            input.value = chosen.display_name.split(',')[0];
            applyLocation(parseFloat(chosen.lat), parseFloat(chosen.lon), chosen.display_name.split(',')[0]);
          }
        });
      });
    } catch (err) {
      console.error('[DroneAstro] Erreur recherche Nominatim:', err);
    }
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      doSearch();
    }
  });

  if (btn) btn.addEventListener('click', doSearch);

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !resultsBox.contains(e.target)) {
      resultsBox.hidden = true;
    }
  });
}

// ── 4. MODULE MÉTÉO (OPEN-METEO) ────────────────────────────────────────────

/**
 * Récupère les données météo Open-Meteo pour le sol et l'altitude sur 12h.
 */
async function fetchWeather(lat, lon) {
  const url = `${CONFIG.OPEN_METEO_URL}?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,precipitation_probability,cloud_cover,visibility` +
    `&hourly=temperature_2m,wind_speed_10m,wind_speed_80m,wind_gusts_10m,precipitation_probability,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility` +
    `&forecast_hours=12&timezone=auto`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const data = await res.json();

  return {
    current: {
      temperature: data.current?.temperature_2m ?? 0,
      humidity: data.current?.relative_humidity_2m ?? 0,
      wind10m: data.current?.wind_speed_10m ?? 0,
      wind80m: data.hourly?.wind_speed_80m?.[0] ?? (data.current?.wind_speed_10m ? data.current.wind_speed_10m * 1.35 : 0),
      gusts: data.current?.wind_gusts_10m ?? 0,
      rainProb: data.current?.precipitation_probability ?? 0,
      cloudTotal: data.current?.cloud_cover ?? 0,
      visibility: data.current?.visibility ?? 10000,
      cloudLow: data.hourly?.cloud_cover_low?.[0] ?? 0,
      cloudMid: data.hourly?.cloud_cover_mid?.[0] ?? 0,
      cloudHigh: data.hourly?.cloud_cover_high?.[0] ?? 0
    },
    hourly: data.hourly || {}
  };
}

// ── 5. MODULE INDICE GÉOMAGNÉTIQUE KP (NOAA SWPC) ───────────────────────────

/**
 * Récupère l'indice Kp planétaire depuis le flux public NOAA SWPC.
 */
async function fetchKpIndex() {
  try {
    const res = await fetch(CONFIG.NOAA_KP_URL);
    if (!res.ok) throw new Error(`NOAA HTTP ${res.status}`);
    const rows = await res.json();

    if (!Array.isArray(rows) || rows.length < 2) {
      return { current: 1.0, history: [] };
    }

    // Le tableau a pour structure : [ ["time_tag", "Kp", ...], [val, val, ...] ]
    const dataRows = rows.slice(1);
    const lastRow = dataRows[dataRows.length - 1];
    const currentKp = parseFloat(lastRow[1]) || 0;

    return {
      current: currentKp,
      history: dataRows.slice(-6).map(r => ({ time: r[0], kp: parseFloat(r[1]) }))
    };
  } catch (err) {
    console.warn('[DroneAstro] NOAA Kp indisponible ou bloqué, valeur par défaut 1.0 utilisée:', err);
    return { current: 1.0, history: [] };
  }
}

// ── 6. MODULE ÉPHÉMÉRIDES & LUNE (SUNCALC) ───────────────────────────────────

/**
 * Calcule tous les horaires solaires et lunaires avec SunCalc.js.
 */
function calculateEphemeris(lat, lon, date = new Date()) {
  const times = SunCalc.getTimes(date, lat, lon);
  const moonIllum = SunCalc.getMoonIllumination(date);
  const moonTimes = SunCalc.getMoonTimes(date, lat, lon);

  // Lendemain pour calculer la fin de nuit astronomique
  const tomorrow = new Date(date.getTime() + 86400000);
  const timesTomorrow = SunCalc.getTimes(tomorrow, lat, lon);

  return {
    times,
    sunrise: times.sunrise,
    sunset: times.sunset,
    goldenHourStart: times.goldenHour,
    goldenHourEnd: times.sunset,
    blueHourStart: times.sunset,
    blueHourEnd: times.dusk,
    astroNightStart: times.night,
    astroNightEnd: timesTomorrow.nightEnd,
    moonPhase: moonIllum.phase,          // 0 -> 1
    moonFraction: moonIllum.fraction,    // 0 -> 1 (illumination)
    moonrise: moonTimes.rise || null,
    moonset: moonTimes.set || null
  };
}

/**
 * Vérifie si la nuit astronomique est active actuellement.
 */
function isAstroNightActive(eph) {
  if (!eph || !eph.times) return false;
  const now = new Date();
  // Nuit active si après 'night' ce soir OU avant 'nightEnd' ce matin
  if (eph.times.night && now >= eph.times.night) return true;
  if (eph.times.nightEnd && now <= eph.times.nightEnd) return true;
  return false;
}

/**
 * Nom français de la phase lunaire.
 */
function getMoonPhaseName(phase) {
  if (phase < 0.05 || phase > 0.95) return 'Nouvelle Lune';
  if (phase < 0.22) return 'Premier Croissant';
  if (phase < 0.28) return 'Premier Quartier';
  if (phase < 0.45) return 'Gibbeuse Croissante';
  if (phase < 0.55) return 'Pleine Lune';
  if (phase < 0.72) return 'Gibbeuse Décroissante';
  if (phase < 0.78) return 'Dernier Quartier';
  return 'Dernier Croissant';
}

// ── 7. LOGIQUE MÉTIER & STATUTS GO / NO-GO ───────────────────────────────────

/**
 * Évalue le statut du vol de drone (calibré pour DJI Neo 2).
 * VERT : Vent < 20 km/h ET Rafales < 25 km/h ET Pluie = 0% ET Kp < 4
 * ORANGE : Vent 20-28 km/h OU Rafales 25-32 km/h OU Kp = 4
 * ROUGE : Vent > 28 km/h OU Rafales > 32 km/h OU Pluie > 0% OU Kp >= 5
 */
function evaluateDroneStatus(currentWeather, kp) {
  const wind = currentWeather.wind10m;
  const gusts = currentWeather.gusts;
  const rain = currentWeather.rainProb;
  const reasons = [];

  const isRed = (wind > CONFIG.DRONE.WIND_WARN) ||
                (gusts > CONFIG.DRONE.GUST_WARN) ||
                (rain > 0) ||
                (kp >= CONFIG.DRONE.KP_DANGER);

  if (isRed) {
    if (wind > CONFIG.DRONE.WIND_WARN) reasons.push(`Vent excessif sol (${wind.toFixed(0)} km/h > 28)`);
    if (gusts > CONFIG.DRONE.GUST_WARN) reasons.push(`Rafales dangereuses (${gusts.toFixed(0)} km/h > 32)`);
    if (rain > 0) reasons.push(`Risque pluie (${rain}%)`);
    if (kp >= CONFIG.DRONE.KP_DANGER) reasons.push(`Perturbation GPS / Kp ${kp.toFixed(1)} ≥ 5`);
    return { status: 'danger', label: 'NO-GO', reasons: reasons.join(' · ') };
  }

  const isOrange = (wind >= CONFIG.DRONE.WIND_GO) ||
                   (gusts >= CONFIG.DRONE.GUST_GO) ||
                   (Math.round(kp) === CONFIG.DRONE.KP_GO);

  if (isOrange) {
    if (wind >= CONFIG.DRONE.WIND_GO) reasons.push(`Vent modéré (${wind.toFixed(0)} km/h)`);
    if (gusts >= CONFIG.DRONE.GUST_GO) reasons.push(`Rafales notables (${gusts.toFixed(0)} km/h)`);
    if (Math.round(kp) === CONFIG.DRONE.KP_GO) reasons.push(`Kp modéré (4.0)`);
    return { status: 'warning', label: 'PRUDENCE', reasons: reasons.join(' · ') };
  }

  return {
    status: 'go',
    label: 'GO',
    reasons: `Vent ${wind.toFixed(0)} km/h · Rafales ${gusts.toFixed(0)} km/h · Ciel sec · Kp ${kp.toFixed(1)}`
  };
}

/**
 * Évalue le statut Photo de Nuit / Astro.
 * VERT : Nuages < 15% ET Lune < 25% ET Nuit astronomique active
 * ORANGE : Nuages 15-40% OU Lune 25-50%
 * ROUGE : Nuages > 40% OU Lune > 50%
 */
function evaluateAstroStatus(currentWeather, moonPct, isNight) {
  const clouds = currentWeather.cloudTotal;
  const reasons = [];

  const isRed = (clouds > CONFIG.ASTRO.CLOUD_WARN) || (moonPct > CONFIG.ASTRO.MOON_WARN);

  if (isRed) {
    if (clouds > CONFIG.ASTRO.CLOUD_WARN) reasons.push(`Couverture nuageuse ${clouds}% > 40%`);
    if (moonPct > CONFIG.ASTRO.MOON_WARN) reasons.push(`Lune trop brillante (${moonPct}% > 50%)`);
    return { status: 'danger', label: 'NO-GO', reasons: reasons.join(' · ') };
  }

  const isOrange = (clouds >= CONFIG.ASTRO.CLOUD_GO) || (moonPct >= CONFIG.ASTRO.MOON_GO) || !isNight;

  if (isOrange) {
    if (clouds >= CONFIG.ASTRO.CLOUD_GO) reasons.push(`Nébulosité partielle (${clouds}%)`);
    if (moonPct >= CONFIG.ASTRO.MOON_GO) reasons.push(`Illumination lunaire (${moonPct}%)`);
    if (!isNight) reasons.push(`Nuit astro non active`);
    return { status: 'warning', label: 'PRUDENCE', reasons: reasons.join(' · ') };
  }

  return {
    status: 'go',
    label: 'GO',
    reasons: `Ciel dégagé (${clouds}%) · Lune sombre (${moonPct}%) · Nuit astro active`
  };
}

// ── 8. MISE À JOUR DE L'INTERFACE UTILISATEUR (UI) ──────────────────────────

/**
 * Met à jour les 2 badges de statut en haut de page.
 */
function updateStatusBadges(droneRes, astroRes) {
  const droneEl = document.getElementById('drone-badge');
  const astroEl = document.getElementById('astro-badge');

  if (droneEl) {
    droneEl.className = `badge badge-drone status-${droneRes.status}`;
    const txt = droneEl.querySelector('.status-text');
    const rsn = droneEl.querySelector('.badge-reason');
    if (txt) txt.textContent = droneRes.label;
    if (rsn) rsn.textContent = droneRes.reasons;
  }

  if (astroEl) {
    astroEl.className = `badge badge-astro status-${astroRes.status}`;
    const txt = astroEl.querySelector('.status-text');
    const rsn = astroEl.querySelector('.badge-reason');
    if (txt) txt.textContent = astroRes.label;
    if (rsn) rsn.textContent = astroRes.reasons;
  }
}

/**
 * Génère une jauge semi-circulaire SVG propre et réactive.
 */
function renderSemiGauge(containerId, value, maxVal, unit, label, warnVal, dangerVal) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const w = 150;
  const h = 88;
  const cx = 75;
  const cy = 76;
  const r = 58;
  const strokeW = 10;
  const semiCirc = Math.PI * r;

  const clamped = Math.min(Math.max(value, 0), maxVal);
  const ratio = clamped / maxVal;
  const dashOffset = semiCirc * (1 - ratio);

  let strokeColor = '#10b981'; // Green
  if (value > dangerVal) strokeColor = '#ef4444'; // Red
  else if (value >= warnVal) strokeColor = '#f59e0b'; // Orange

  container.innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" width="100%" style="overflow:visible;">
      <path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}"
            fill="none" stroke="#1e293b" stroke-width="${strokeW}" stroke-linecap="round"/>
      <path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}"
            fill="none" stroke="${strokeColor}" stroke-width="${strokeW}" stroke-linecap="round"
            stroke-dasharray="${semiCirc}" stroke-dashoffset="${dashOffset}"
            style="transition: stroke-dashoffset 0.8s ease, stroke 0.4s ease; filter: drop-shadow(0 0 6px ${strokeColor});"/>
      <text x="${cx}" y="${cy - 14}" text-anchor="middle" fill="#f8fafc"
            font-size="22" font-weight="800" font-family="system-ui, sans-serif">${Math.round(value)}</text>
      <text x="${cx}" y="${cy + 1}" text-anchor="middle" fill="#94a3b8"
            font-size="10" font-weight="600">${unit}</text>
    </svg>
    <div class="gauge-label">${label}</div>
  `;
}

/**
 * Met à jour la carte Vent (10m, 80m et rafales).
 */
function updateWindCard(cur) {
  renderSemiGauge('gauge-wind-10m', cur.wind10m, 50, 'km/h', 'Sol (10m)', CONFIG.DRONE.WIND_GO, CONFIG.DRONE.WIND_WARN);
  renderSemiGauge('gauge-wind-80m', cur.wind80m, 60, 'km/h', 'Altitude (80m)', CONFIG.DRONE.WIND_GO * 1.25, CONFIG.DRONE.WIND_WARN * 1.25);

  const gustValEl = document.getElementById('gust-value');
  const gustBarEl = document.getElementById('gust-bar');

  if (gustValEl) gustValEl.textContent = `${Math.round(cur.gusts)} km/h`;
  if (gustBarEl) {
    const pct = Math.min((cur.gusts / 50) * 100, 100);
    gustBarEl.style.width = `${pct}%`;
  }
}

/**
 * Met à jour la carte des conditions météo générales.
 */
function updateConditionsCard(cur) {
  const tempEl = document.getElementById('temp-value');
  const rainEl = document.getElementById('rain-value');
  const visEl = document.getElementById('visibility-value');
  const humEl = document.getElementById('humidity-value');

  if (tempEl) tempEl.textContent = `${Math.round(cur.temperature)}°C`;
  if (rainEl) rainEl.textContent = `${cur.rainProb}%`;
  if (visEl) visEl.textContent = `${(cur.visibility / 1000).toFixed(1)} km`;
  if (humEl) humEl.textContent = `${cur.humidity}%`;
}

/**
 * Met à jour la carte de l'indice Kp.
 */
function updateKpCard(kpVal) {
  const valEl = document.getElementById('kp-value');
  const descEl = document.getElementById('kp-description');
  const barEl = document.getElementById('kp-bar');

  if (valEl) valEl.textContent = kpVal.toFixed(1);

  if (descEl) {
    let desc = 'Activité géomagnétique calme';
    let color = '#10b981';
    if (kpVal >= 5) {
      desc = 'Tempête géomagnétique (GPS instable)';
      color = '#ef4444';
    } else if (kpVal >= 4) {
      desc = 'Activité modérée (Surveiller GPS)';
      color = '#f59e0b';
    }
    descEl.textContent = desc;
    descEl.style.color = color;
  }

  if (barEl) {
    const rounded = Math.min(Math.max(Math.round(kpVal), 0), 9);
    barEl.querySelectorAll('.kp-segment').forEach(seg => {
      const segVal = parseInt(seg.dataset.value, 10);
      if (segVal === rounded) {
        seg.classList.add('active');
      } else {
        seg.classList.remove('active');
      }
    });
  }
}

/**
 * Met à jour la carte de couverture nuageuse.
 */
function updateCloudCard(cur) {
  const updateLayer = (valId, barId, val) => {
    const vEl = document.getElementById(valId);
    const bEl = document.getElementById(barId);
    if (vEl) vEl.textContent = `${Math.round(val)}%`;
    if (bEl) bEl.style.width = `${Math.min(Math.max(val, 0), 100)}%`;
  };

  updateLayer('cloud-total', 'cloud-total-bar', cur.cloudTotal);
  updateLayer('cloud-low', 'cloud-low-bar', cur.cloudLow);
  updateLayer('cloud-mid', 'cloud-mid-bar', cur.cloudMid);
  updateLayer('cloud-high', 'cloud-high-bar', cur.cloudHigh);
}

/**
 * Met à jour la carte des éphémérides et la chronologie 24h.
 */
function updateEphemerisCard(eph) {
  const fmt = (d) => {
    if (!d || isNaN(d)) return '--:--';
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  };

  const sunriseEl = document.getElementById('sunrise');
  const sunsetEl = document.getElementById('sunset');
  const goldenEl = document.getElementById('golden-hour');
  const blueEl = document.getElementById('blue-hour');
  const nightEl = document.getElementById('astro-night');

  if (sunriseEl) sunriseEl.textContent = fmt(eph.sunrise);
  if (sunsetEl) sunsetEl.textContent = fmt(eph.sunset);
  if (goldenEl) goldenEl.textContent = `${fmt(eph.goldenHourStart)} → ${fmt(eph.goldenHourEnd)}`;
  if (blueEl) blueEl.textContent = `${fmt(eph.blueHourStart)} → ${fmt(eph.blueHourEnd)}`;
  if (nightEl) nightEl.textContent = `${fmt(eph.astroNightStart)} → ${fmt(eph.astroNightEnd)}`;

  // Chronologie 24h solaire
  renderTimeline(eph);
}

/**
 * Calcule et dessine la barre chronologique de la journée (0h-24h).
 */
function renderTimeline(eph) {
  const timelineEl = document.getElementById('sun-timeline');
  const nowMarker = document.getElementById('timeline-now');
  if (!timelineEl) return;

  const toPct = (d) => {
    if (!d) return 0;
    const mins = d.getHours() * 60 + d.getMinutes();
    return (mins / 1440) * 100;
  };

  const dawnPct = toPct(eph.times?.dawn || new Date(0));
  const sunrisePct = toPct(eph.sunrise);
  const goldenMornPct = toPct(eph.times?.goldenHourEnd);
  const goldenEvePct = toPct(eph.goldenHourStart);
  const sunsetPct = toPct(eph.sunset);
  const duskPct = toPct(eph.times?.dusk);

  timelineEl.innerHTML = `
    <div class="timeline-segment night" style="width: ${dawnPct}%;" title="Nuit"></div>
    <div class="timeline-segment blue" style="width: ${Math.max(sunrisePct - dawnPct, 2)}%;" title="Heure Bleue Matin"></div>
    <div class="timeline-segment golden" style="width: ${Math.max(goldenMornPct - sunrisePct, 2)}%;" title="Heure Dorée Matin"></div>
    <div class="timeline-segment day" style="width: ${Math.max(goldenEvePct - goldenMornPct, 5)}%;" title="Journée"></div>
    <div class="timeline-segment golden" style="width: ${Math.max(sunsetPct - goldenEvePct, 2)}%;" title="Heure Dorée Soir"></div>
    <div class="timeline-segment blue" style="width: ${Math.max(duskPct - sunsetPct, 2)}%;" title="Heure Bleue Soir"></div>
    <div class="timeline-segment night" style="width: ${Math.max(100 - duskPct, 2)}%;" title="Nuit"></div>
  `;

  if (nowMarker) {
    const nowPct = toPct(new Date());
    nowMarker.style.left = `${nowPct}%`;
  }
}

/**
 * Met à jour la carte Lunaire (visuel CSS, illumination, lever/coucher).
 */
function updateMoonCard(eph) {
  const nameEl = document.getElementById('moon-phase-name');
  const illumEl = document.getElementById('moon-illumination');
  const riseEl = document.getElementById('moonrise');
  const setEl = document.getElementById('moonset');
  const shadowEl = document.getElementById('moon-shadow');

  const phase = eph.moonPhase;
  const illumPct = Math.round(eph.moonFraction * 100);

  if (nameEl) nameEl.textContent = getMoonPhaseName(phase);
  if (illumEl) illumEl.textContent = `${illumPct}%`;

  const fmt = (d) => d ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '--:--';
  if (riseEl) riseEl.textContent = fmt(eph.moonrise);
  if (setEl) setEl.textContent = fmt(eph.moonset);

  // Visuel CSS de l'ombre lunaire
  if (shadowEl) {
    if (phase <= 0.5) {
      // Croissante
      const shadowPct = (1 - phase * 2) * 100;
      shadowEl.style.left = 'auto';
      shadowEl.style.right = '0';
      shadowEl.style.width = `${shadowPct}%`;
    } else {
      // Décroissante
      const shadowPct = ((phase - 0.5) * 2) * 100;
      shadowEl.style.left = '0';
      shadowEl.style.right = 'auto';
      shadowEl.style.width = `${shadowPct}%`;
    }
  }
}

// ── 9. MODULE GRAPHIQUE 6 HEURES (CHART.JS) ─────────────────────────────────

/**
 * Initialise le graphique Chart.js avec double axe Y et thème sombre.
 */
function initForecastChart() {
  const canvas = document.getElementById('forecast-chart');
  if (!canvas || typeof Chart === 'undefined') return;

  const ctx = canvas.getContext('2d');

  forecastChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Vent (km/h)',
          data: [],
          borderColor: '#06b6d4',
          backgroundColor: 'rgba(6, 182, 212, 0.15)',
          fill: true,
          tension: 0.35,
          borderWidth: 2.5,
          pointRadius: 3,
          pointBackgroundColor: '#06b6d4',
          yAxisID: 'y'
        },
        {
          label: 'Rafales (km/h)',
          data: [],
          borderColor: '#f59e0b',
          borderDash: [4, 4],
          backgroundColor: 'transparent',
          fill: false,
          tension: 0.35,
          borderWidth: 2,
          pointRadius: 2.5,
          pointBackgroundColor: '#f59e0b',
          yAxisID: 'y'
        },
        {
          label: 'Nuages (%)',
          data: [],
          borderColor: '#a855f7',
          backgroundColor: 'rgba(168, 85, 247, 0.12)',
          fill: true,
          tension: 0.35,
          borderWidth: 2,
          pointRadius: 2.5,
          pointBackgroundColor: '#a855f7',
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#94a3b8',
            font: { size: 10, weight: '600' },
            boxWidth: 12,
            padding: 8
          }
        },
        tooltip: {
          backgroundColor: '#0f172a',
          titleColor: '#f8fafc',
          bodyColor: '#cbd5e1',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          padding: 8,
          cornerRadius: 8
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#94a3b8', font: { size: 10 } }
        },
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          title: {
            display: false
          },
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#06b6d4', font: { size: 10 } },
          beginAtZero: true
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          min: 0,
          max: 100,
          grid: { drawOnChartArea: false },
          ticks: { color: '#a855f7', font: { size: 10 }, stepSize: 25 }
        }
      }
    }
  });
}

/**
 * Met à jour le graphique avec les 6 prochaines heures.
 */
function updateForecastChart(hourly) {
  if (!forecastChart || !hourly.time) return;

  const count = Math.min(6, hourly.time.length);
  const labels = [];
  const windData = [];
  const gustData = [];
  const cloudData = [];

  for (let i = 0; i < count; i++) {
    const dt = new Date(hourly.time[i]);
    labels.push(dt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }));
    windData.push(hourly.wind_speed_10m[i]);
    gustData.push(hourly.wind_gusts_10m[i]);
    cloudData.push(hourly.cloud_cover[i]);
  }

  forecastChart.data.labels = labels;
  forecastChart.data.datasets[0].data = windData;
  forecastChart.data.datasets[1].data = gustData;
  forecastChart.data.datasets[2].data = cloudData;
  forecastChart.update();
}

// ── 10. MODULE CARTE & ZONES DE VOL (LEAFLET) ───────────────────────────────

/**
 * Initialise la carte Leaflet avec tuiles Carto Dark Matter.
 */
function initMap(lat, lon) {
  const mapEl = document.getElementById('map');
  if (!mapEl || typeof L === 'undefined') return;

  try {
    leafletMap = L.map('map', {
      center: [lat, lon],
      zoom: 12,
      zoomControl: true,
      attributionControl: false
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd',
      maxZoom: 19
    }).addTo(leafletMap);

    const customIcon = L.divIcon({
      className: 'custom-marker',
      html: '<div class="marker-dot"></div>',
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });

    leafletMarker = L.marker([lat, lon], { icon: customIcon }).addTo(leafletMap);
    leafletMarker.bindPopup(`<strong>Point d'envol</strong><br>${lat}°N, ${lon}°E`);

    setTimeout(() => {
      if (leafletMap) leafletMap.invalidateSize();
    }, 400);
  } catch (err) {
    console.warn('[DroneAstro] Leaflet init error:', err);
  }
}

/**
 * Déplace la vue et le marqueur Leaflet.
 */
function updateMapPosition(lat, lon) {
  if (!leafletMap || !leafletMarker) return;
  leafletMarker.setLatLng([lat, lon]);
  leafletMarker.setPopupContent(`<strong>Point d'envol</strong><br>${lat}°N, ${lon}°E`);
  leafletMap.setView([lat, lon], 12);
}

/**
 * Ouvre la carte Géoportail des restrictions UAS drones en France.
 */
function openGeoportailUAS() {
  const lat = state.lat ?? CONFIG.DEFAULT_LAT;
  const lon = state.lon ?? CONFIG.DEFAULT_LON;
  const url = `https://www.geoportail.gouv.fr/carte?c=${lon},${lat}&z=12&l0=RESTRICTION_UAS::GEOPORTAIL:OGC:WMTS(1)&permalink=yes`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

// ── 11. ORCHESTRATEUR PRINCIPAL (REFRESH ALL) ───────────────────────────────

/**
 * Charge toutes les données en parallèle et actualise chaque module UI.
 */
async function refreshAllData() {
  if (state.lat === null || state.lon === null) return;

  const overlay = document.getElementById('loading-overlay');
  if (overlay) overlay.classList.remove('hidden');

  try {
    // 1. Récupération parallèle Météo + Kp
    const [weatherRes, kpRes] = await Promise.all([
      fetchWeather(state.lat, state.lon),
      fetchKpIndex()
    ]);

    state.weather = weatherRes;
    state.kpIndex = kpRes.current;
    state.kpData = kpRes.history;

    // 2. Calculs astronomiques locaux via SunCalc
    const now = new Date();
    state.ephemeris = calculateEphemeris(state.lat, state.lon, now);
    const moonPct = Math.round(state.ephemeris.moonFraction * 100);
    const isNight = isAstroNightActive(state.ephemeris);

    // 3. Évaluation GO / NO-GO
    const droneEval = evaluateDroneStatus(state.weather.current, state.kpIndex);
    const astroEval = evaluateAstroStatus(state.weather.current, moonPct, isNight);

    // 4. Mises à jour des vues
    updateStatusBadges(droneEval, astroEval);
    updateWindCard(state.weather.current);
    updateConditionsCard(state.weather.current);
    updateKpCard(state.kpIndex);
    updateCloudCard(state.weather.current);
    updateEphemerisCard(state.ephemeris);
    updateMoonCard(state.ephemeris);
    updateForecastChart(state.weather.hourly);

    // 5. Horodatage
    const updateEl = document.getElementById('last-update');
    if (updateEl) {
      updateEl.textContent = `Actualisé à ${now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
    }
  } catch (err) {
    console.error('[DroneAstro] Erreur de chargement:', err);
    showErrorToast('Erreur lors de la mise à jour météo. Données partielles.');
  } finally {
    if (overlay) {
      setTimeout(() => overlay.classList.add('hidden'), 200);
    }
  }
}

/**
 * Toast de notification d'erreur.
 */
function showErrorToast(msg) {
  const toast = document.getElementById('error-toast');
  const msgEl = document.getElementById('error-message');
  if (!toast || !msgEl) return;
  msgEl.textContent = msg;
  toast.hidden = false;
  setTimeout(() => { toast.hidden = true; }, 5000);
}

// ── 12. INITIALISATION AU DÉMARRAGE ──────────────────────────────────────────

function initApp() {
  console.log('[DroneAstro] Initialisation PWA Field Assistant...');

  // Enregistrement du Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js')
      .then(() => console.log('[DroneAstro] Service Worker actif.'))
      .catch((e) => console.warn('[DroneAstro] Échec Service Worker:', e));
  }

  // Initialisation carte et graphique
  initMap(CONFIG.DEFAULT_LAT, CONFIG.DEFAULT_LON);
  initForecastChart();

  // Écouteurs de recherche et boutons
  setupSearchListeners();

  const btnGeo = document.getElementById('btn-geoportail');
  if (btnGeo) btnGeo.addEventListener('click', openGeoportailUAS);

  const errClose = document.getElementById('error-close');
  if (errClose) {
    errClose.addEventListener('click', () => {
      const toast = document.getElementById('error-toast');
      if (toast) toast.hidden = true;
    });
  }

  // Démarrage de la géolocalisation
  initGeolocation();

  // Intervalle de rafraîchissement auto (5 minutes)
  setInterval(() => {
    console.log('[DroneAstro] Rafraîchissement automatique...');
    refreshAllData();
  }, CONFIG.REFRESH_INTERVAL);
}

// Lancement au chargement du DOM
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
