# DroneAstro Assistant PWA 🛸✨

> **Assistant de terrain moderne et autonome pour sorties drone (DJI Neo 2) et astrophotographie.**
> Conçu pour smartphone Android haut de gamme (optimisé pour le format AMOLED / Samsung Galaxy S24 Ultra en Dark Mode).

---

## 🌟 Fonctionnalités Clés

- **100% Gratuit / Zéro clé API payante :**
  - **Météo temps réel & prévisions 12h :** [Open-Meteo](https://open-meteo.com/) (vent au sol à 10m et en altitude à 80m & 150m via 3 jauges dédiées, rafales, température, probabilité de pluie, couverture nuageuse par étage, visibilité).
  - **Activité géomagnétique (Indice Kp) :** Flux JSON officiel de la [NOAA Space Weather Prediction Center (SWPC)](https://services.swpc.noaa.gov/).
  - **Éphémérides solaires & lunaires :** Calculs locaux haute précision via [SunCalc.js](https://github.com/mourner/suncalc) (lever/coucher, Golden Hour, Heure Bleue, Nuit Astronomique, phases et illumination de la Lune).
  - **Zones de restrictions UAS :** Accès direct en 1 clic à la carte officielle Géoportail des restrictions de vol pour drones en France centrée sur vos coordonnées GPS.
  - **Géolocalisation & Recherche :** API `navigator.geolocation` avec géocodage inverse et champ de recherche OpenStreetMap / Nominatim.

- **Indicateurs Métier GO / NO-GO :**
  - 🟢 **Statut Vol Drone (calibré pour drone ultraléger DJI Neo 2) :**
    - **VERT (GO) :** Vent < 20 km/h ET Rafales < 25 km/h ET Pluie = 0% ET Kp < 4.
    - **ORANGE (PRUDENCE) :** Vent 20–28 km/h OU Rafales 25–32 km/h OU Kp = 4.
    - **ROUGE (NO-GO) :** Vent > 28 km/h OU Rafales > 32 km/h OU Pluie > 0% OU Kp ≥ 5.
  - 🟣 **Statut Photo de Nuit & Astro :**
    - **VERT (GO) :** Couverture nuageuse < 15% ET Illumination lunaire < 25% ET Nuit astronomique active.
    - **ORANGE (PRUDENCE) :** Couverture nuageuse 15–40% OU Illumination lunaire 25–50%.
    - **ROUGE (NO-GO) :** Couverture nuageuse > 40% OU Illumination lunaire > 50%.

- **Architecture PWA (Progressive Web App) :**
  - Installable sur mobile (`manifest.json`)
  - Mode hors-ligne et mise en cache intelligente (`service-worker.js`)
  - Interface Dark Mode glassmorphique sur mesure (HTML5, CSS3 fluide, Vanilla JavaScript modulaire)
  - Graphique d'évolution horaire sur 6h avec [Chart.js](https://www.chartjs.org/)

---

## 🚀 Installation & Déploiement

Cette application est une application web statique sans dépendance serveur. Elle peut être hébergée directement sur **GitHub Pages**.

1. Cloner le dépôt :
   ```bash
   git clone https://github.com/<utilisateur>/drone-astro-pwa.git
   cd drone-astro-pwa
   ```
2. Ouvrir `index.html` dans un navigateur ou lancer un serveur local :
   ```bash
   python -m http.server 8080
   ```
3. Accéder à `http://localhost:8080`
