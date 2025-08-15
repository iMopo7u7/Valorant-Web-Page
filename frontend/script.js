const grid = document.getElementById("leaderboardGrid");
const API_URL = "https://valorant-10-mans-backend.onrender.com"; // tu backend

if (grid) {
  async function loadLeaderboard() {
    // Cabecera del grid
    grid.innerHTML = `
      <div class="grid-header">
        <div class="header-cell">#</div>
        <div class="header-cell">Jugador</div>
        <div class="header-cell">ACS Promedio</div>
        <div class="header-cell">KDA Promedio</div>
        <div class="header-cell">HS%</div>
        <div class="header-cell">First Bloods Promedio</div>
        <div class="header-cell">Winrate %</div>
        <div class="header-cell">Score Compuesto</div>
      </div>
    `;

    try {
      const res = await fetch(`${API_URL}/leaderboard`);
      if (!res.ok) throw new Error("Error en la respuesta del servidor");

      const players = await res.json();

      if (!players || players.length === 0) {
        const emptyDiv = document.createElement("div");
        emptyDiv.className = "loading-state";
        emptyDiv.textContent = "No hay datos para mostrar";
        grid.appendChild(emptyDiv);
        return;
      }

      // Crear filas
      players.forEach((p, i) => {
        const row = document.createElement("div");
        row.className = `grid-row rank-${i + 1}`;
        row.innerHTML = `
          <div class="data-cell" data-label="Posición">${i + 1}</div>
          <div class="data-cell" data-label="Jugador">${p.name}#${p.tag}</div>
          <div class="data-cell stat-acs" data-label="ACS Promedio">${(p.avgACS || 0).toFixed(2)}</div>
          <div class="data-cell stat-kda" data-label="KDA Promedio">${(p.avgKDA || 0).toFixed(2)}</div>
          <div class="data-cell" data-label="HS%">${(p.hsPercent || 0).toFixed(2)}%</div>
          <div class="data-cell" data-label="First Bloods">${(p.avgFirstBloods || 0).toFixed(2)}</div>
          <div class="data-cell stat-winrate" data-label="Winrate %">${(p.winrate || 0).toFixed(2)}%</div>
          <div class="data-cell stat-score" data-label="Score">${(p.score || 0).toFixed(2)}</div>
        `;
        grid.appendChild(row);
      });

    } catch (err) {
      console.error("Error cargando leaderboard:", err);
      grid.innerHTML = `
        <div class="loading-state">Error cargando leaderboard</div>
      `;
    }
  }

  // Cargar al inicio
  document.addEventListener("DOMContentLoaded", loadLeaderboard);
}
