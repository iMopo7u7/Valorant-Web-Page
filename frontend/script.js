const tbody = document.getElementById("leaderboardBody");

fetch("https://valorant-10-mans.onrender.com/leaderboard")
  .then((res) => res.json())
  .then((players) => {
    tbody.innerHTML = "";
    if (players.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="8" style="color:#ff4655;">No hay datos para mostrar</td></tr>';
      return;
    }
    players.forEach((p, i) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td data-label="Posición" style="text-align:center;">
          <span class="rank-badge">${i + 1}</span>
        </td>
        <td data-label="Jugador" class="player-name" style="text-align:left;">
          ${p.name}#${p.tag}
        </td>
        <td data-label="ACS Promedio" style="text-align:center;">${p.avgACS.toFixed(2)}</td>
        <td data-label="KDA Promedio" style="text-align:center;">${p.avgKDA.toFixed(2)}</td>
        <td data-label="HS%" style="text-align:center;">${p.hsPercent.toFixed(2)}%</td>
        <td data-label="First Bloods Promedio" style="text-align:center;">${p.avgFirstBloods.toFixed(2)}</td>
        <td data-label="Winrate %" style="text-align:center;">${p.winrate.toFixed(2)}%</td>
        <td data-label="Score Compuesto" style="text-align:center;">${p.score.toFixed(2)}</td>
      `;
      tbody.appendChild(tr);
    });
  })
  .catch(() => {
    tbody.innerHTML =
      '<tr><td colspan="8" style="color:#ff4655;">Error cargando leaderboard</td></tr>';
  });
