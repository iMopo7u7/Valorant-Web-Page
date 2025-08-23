// ==========================
// 🔧 API CONFIG
// ==========================
const API_BASE_URL = "https://valorant-10-mans.onrender.com"; 

// ==========================
// 🔧 UTILS
// ==========================
function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });
}

function getRankIcon(position) {
  switch (position) {
    case 1: return '🏆';
    case 2: return '🥈';
    case 3: return '🥉';
    default: return position;
  }
}

function getRankClass(position) {
  switch (position) {
    case 1: return 'gold';
    case 2: return 'silver';
    case 3: return 'bronze';
    default: return '';
  }
}

function getBadgeIcon(type) {
  switch (type) {
    case 'champion': return '👑';
    case 'finalist': return '🥈';
    case 'semifinalist': return '🥉';
    case 'participant': return '🎯';
    default: return '🎮';
  }
}

function createBadges(badges) {
  return badges.map(badge => 
    `<span class="badge ${badge.type}" 
           data-tournament="${badge.tournament}" 
           data-date="${badge.date}" 
           data-placement="${badge.placement || ''}">
      ${getBadgeIcon(badge.type)}
    </span>`
  ).join('');
}

// ==========================
// 🔧 SOCIAL LINKS
// ==========================
function createSocialLinks(social) {
  const icons = {
    twitter: `<svg viewBox="0 0 24 24" fill="currentColor" class="social-icon" width="16" height="16">
                <path d="M23 3a10.9 10.9 0 0 1-3.14 1.53 4.48 4.48 0 0 0-7.86 3v1A10.66 10.66 0 0 1 3 4s-4 9 5 13a11.64 11.64 0 0 1-7 2c9 5 20 0 20-11.5a4.5 4.5 0 0 0-.08-.83A7.72 7.72 0 0 0 23 3z"/>
              </svg>`,
    valorantTracker: `<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" class="social-icon" width="16" height="16">
                    <title>Valorant</title>
                    <path d="M23.792 2.152a.252.252 0 0 0-.098.083c-3.384 4.23-6.769 8.46-10.15 12.69-.107.093-.025.288.119.265 2.439.003 4.877 0 7.316.001a.66.66 0 0 0 .552-.25c.774-.967 1.55-1.934 2.324-2.903a.72.72 0 0 0 .144-.49c-.002-3.077 0-6.153-.003-9.23.016-.11-.1-.206-.204-.167zM.077 2.166c-.077.038-.074.132-.076.205.002 3.074.001 6.15.001 9.225a.679.679 0 0 0 .158.463l7.64 9.55c.12.152.308.25.505.247 2.455 0 4.91.003 7.365 0 .142.02.222-.174.116-.265C10.661 15.176 5.526 8.766.4 2.35c-.08-.094-.174-.272-.322-.184z"/>
                  </svg>`,
    twitch: `<svg viewBox="0 0 24 24" fill="currentColor" class="social-icon" width="16" height="16">
               <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/>
             </svg>`
  };

  let html = '<div class="player-social">';

  // Recorremos todas las redes que tenga el jugador
  for (const key in social) {
    if (social[key] && icons[key]) {
      html += `<a href="${social[key]}" target="_blank" title="${key}">${icons[key]}</a>`;
    }
  }

  html += '</div>';
  return html;
}

// ==========================
// 🔧 API SERVICE
// ==========================
class ApiService {
  static async fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Error ${res.status} en ${url}`);
    return res.json();
  }

  static async getLeaderboard() {
    return this.fetchJson(`${API_BASE_URL}/leaderboard`);
  }

  static async getStats() {
    const [matchesCount, playersCount, lastMatch] = await Promise.all([
      this.fetchJson(`${API_BASE_URL}/matches-count`),
      this.fetchJson(`${API_BASE_URL}/players-count`),
      this.fetchJson(`${API_BASE_URL}/last-match`)
    ]);

    return {
      totalMatches: matchesCount.count || 0,
      totalPlayers: playersCount.count || 0,
      lastUpdate: lastMatch.date ? formatDate(lastMatch.date) : "No disponible"
    };
  }
}

// ==========================
// 🔧 RENDER FUNCTIONS
// ==========================
async function renderSystemStats() {
  try {
    const stats = await ApiService.getStats();
    document.getElementById("total-matches").textContent = stats.totalMatches;
    document.getElementById("total-players").textContent = stats.totalPlayers;
    document.getElementById("last-update").textContent = stats.lastUpdate;
  } catch (err) {
    console.error("Error cargando stats:", err);
  }
}

async function renderTopPlayers(players) {
  const topPlayersContainer = document.getElementById('top-players');
  const topThree = players.slice(0, 3);

  topPlayersContainer.innerHTML = topThree.map((player, index) => `
    <div class="top-player-card rank-${index + 1}">
      <div class="rank-icon">${getRankIcon(index + 1)}</div>
      <div class="player-name">${player.name}</div>
      <div class="player-tag">#${player.tag}</div>
      <div class="player-score">${player.score}</div>
      <div class="player-badges">
        ${createBadges(player.badges?.slice(0, 3) || [])}
      </div>
      ${createSocialLinks(player.social || {})}
    </div>
  `).join('');
}

async function renderLeaderboardTable(players) {
  const tbody = document.getElementById('rankings-tbody');

  tbody.innerHTML = players.map((p, index) => `
    <tr class="${index < 3 ? 'top-3' : ''}">
      <td class="rank-cell">
        <div class="rank-badge ${getRankClass(index + 1)}">
          ${getRankIcon(index + 1)}
        </div>
      </td>
      <td class="player-info">
        <div class="player-main">
          <div>
            <div class="player-name-link">${p.name}</div>
            <div class="player-tag-text">#${p.tag}</div>
          </div>
        </div>
        <div class="player-meta">
          <div class="badges-container">
            ${createBadges(p.badges || [])}
          </div>
          ${createSocialLinks(p.social || {})}
        </div>
      </td>
      <td class="stat-cell">${Math.round(p.avgACS) || 0}</td>
      <td class="stat-cell">${p.avgKDA ? p.avgKDA.toFixed(2) : "0.00"}</td>
      <td class="stat-cell">${p.hsPercent ? p.hsPercent.toFixed(1) : 0}%</td>
      <td class="stat-cell">${p.fk ? p.fk.toFixed(1) : 0}</td>
      <td class="stat-cell">${p.winrate ? p.winrate.toFixed(1) : 0}%</td>
      <td class="score-cell">
        <div class="score-value">${p.score}</div>
      </td>
    </tr>
  `).join('');
}

// ==========================
// 🔧 INIT
// ==========================
async function initializeApp() {
  try {
    await renderSystemStats();
    const players = await ApiService.getLeaderboard();

    // Ordenar por score antes de renderizar
    players.sort((a, b) => b.score - a.score);

    await renderTopPlayers(players);
    await renderLeaderboardTable(players);

    console.log("Frontend conectado al backend ✅");
  } catch (err) {
    console.error("Error inicializando la app:", err);
  }
}

document.addEventListener("DOMContentLoaded", initializeApp);
