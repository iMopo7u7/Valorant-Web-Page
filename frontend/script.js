// ==========================
// 🔧 API CONFIG
// ==========================
const API_BASE_URL = "https://valorant-10-mans.onrender.com"; 

// ==========================
// 🔧 UTILS
// ==========================
function formatRelativeDate(dateString) {
  if (!dateString) return "No disponible";
  const now = new Date();
  const date = new Date(dateString);
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffH = Math.floor(diffMin / 60);
  const diffD = Math.floor(diffH / 24);

  if (diffSec < 60) return "hace unos segundos";
  if (diffMin < 60) return `hace ${diffMin} ${diffMin === 1 ? "minuto" : "minutos"}`;
  if (diffH < 24) return `hace ${diffH} ${diffH === 1 ? "hora" : "horas"}`;
  return `hace ${diffD} ${diffD === 1 ? "día" : "días"}`;
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
  let html = '<div class="social-links">';
  
  if (social.tracker) {
    html += `<a href="${social.tracker}" target="_blank" rel="noopener noreferrer" class="social-link" title="Valorant Tracker">
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6m4-3h6v6m-11 5L21 3"/>
      </svg>
    </a>`;
  }
  
  if (social.twitter) {
    html += `<a href="${social.twitter}" target="_blank" rel="noopener noreferrer" class="social-link" title="Twitter">
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M23 3a10.9 10.9 0 0 1-3.14 1.53 4.48 4.48 0 0 0-7.86 3v1A10.66 10.66 0 0 1 3 4s-4 9 5 13a11.64 11.64 0 0 1-7 2c9 5 20 0 20-11.5a4.5 4.5 0 0 0-.08-.83A7.72 7.72 0 0 0 23 3z"/>
      </svg>
    </a>`;
  }
  
  if (social.twitch) {
    html += `<a href="${social.twitch}" target="_blank" rel="noopener noreferrer" class="social-link" title="Twitch">
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/>
      </svg>
    </a>`;
  }
  
  html += '</div>';
  return html;
}

// ==========================
// 🔧 AVATAR HELPERS
// ==========================
function getPlayerAvatar(player) {
  return player.avatarURL || "https://cdn.discordapp.com/embed/avatars/0.png";
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
      lastUpdate: lastMatch.date ? formatRelativeDate(lastMatch.date) : "No disponible"
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
      <img class="player-avatar" src="${getPlayerAvatar(player)}" alt="${player.name}">
      <div class="player-name">${player.name}</div>
      <div class="player-tag">#${player.tag}</div>
      <div class="player-score">${Math.max(Math.round(player.score),0)}</div>
      <div class="player-badges">
        ${createBadges(player.badges?.slice(0, 3) || [])}
      </div>
      ${createSocialLinks(player.social || {})}
    </div>
  `).join('');
}

async function renderLeaderboardTable(players) {
  const tbody = document.getElementById('rankings-tbody');

  tbody.innerHTML = players.map((p, index) => {
    const avgACS = p.matchesPlayed ? Math.round(p.totalACS / p.matchesPlayed) : 0;
    const avgKDA = p.totalDeaths ? ((p.totalKills + p.totalAssists) / p.totalDeaths).toFixed(2) : "0.00";
    const hsPercent = p.totalKills && p.totalHeadshotKills ? ((p.totalHeadshotKills / p.totalKills) * 100).toFixed(1) : "0.0";
    const kastPercent = p.kastPercent?.toFixed(1) || "0.0";
    const fk = p.FK || 0;
    const matches = p.matchesPlayed || 0;
    const score = Math.max(Math.round(p.score),0);

    return `
      <tr class="${index < 3 ? 'top-3' : ''}">
        <td class="rank-cell">
          <div class="rank-badge ${getRankClass(index + 1)}">
            ${getRankIcon(index + 1)}
          </div>
        </td>
        <td class="player-info">
          <div class="player-main">
            <img class="player-avatar-table" src="${getPlayerAvatar(p)}" alt="${p.name}">
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
        <td class="stat-cell">${matches}</td>
        <td class="stat-cell">${avgACS}</td>
        <td class="stat-cell">${avgKDA}</td>
        <td class="stat-cell">${hsPercent}%</td>
        <td class="stat-cell">${fk}</td>
        <td class="stat-cell">${kastPercent}%</td>
        <td class="score-cell">${score}</td>
      </tr>
    `;
  }).join('');
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
