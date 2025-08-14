const grid = document.getElementById("leaderboardGrid");

// Función para cargar los datos en el grid
fetch("https://valorant-10-mans.onrender.com/leaderboard")
  .then((res) => res.json())
  .then((players) => {
    // Limpiar grid
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

    if (players.length === 0) {
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
        <div class="data-cell stat-acs" data-label="ACS Promedio">${p.avgACS.toFixed(2)}</div>
        <div class="data-cell stat-kda" data-label="KDA Promedio">${p.avgKDA.toFixed(2)}</div>
        <div class="data-cell" data-label="HS%">${p.hsPercent.toFixed(2)}%</div>
        <div class="data-cell" data-label="First Bloods">${p.avgFirstBloods.toFixed(2)}</div>
        <div class="data-cell stat-winrate" data-label="Winrate %">${p.winrate.toFixed(2)}%</div>
        <div class="data-cell stat-score" data-label="Score">${p.score.toFixed(2)}</div>
      `;
      grid.appendChild(row);
    });
  })
  .catch(() => {
    grid.innerHTML = `
      <div class="loading-state">Error cargando leaderboard</div>
    `;
  });
