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

function createSocialLinks(social) {
  let html = '<div class="player-social">';
  
  if (social.twitter) {
    html += `<a href="${social.twitter}" target="_blank" title="Twitter">
      <img src="assets/twitter-icon.png" alt="Twitter" class="social-icon">
    </a>`;
  }
  
  if (social.valorantTracker) {
    html += `<a href="${social.valorantTracker}" target="_blank" title="Valorant Tracker">
      <img src="assets/tracker-icon.png" alt="Tracker" class="social-icon">
    </a>`;
  }
  
  if (social.twitch) {
    html += `<a href="${social.twitch}" target="_blank" title="Twitch">
      <img src="assets/twitch-icon.png" alt="Twitch" class="social-icon">
    </a>`;
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
