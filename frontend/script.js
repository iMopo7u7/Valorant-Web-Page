const tbody = document.getElementById("leaderboardBody");

fetch("https://valorant-10-mans.onrender.com/leaderboard")
  .then((res) => res.json())
  .then((players) => {
    tbody.innerHTML = "";
    if (players.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="8" style="color:#ff4655; text-align:center;">No hay datos para mostrar</td></tr>';
      return;
    }
    players.forEach((p, i) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td data-label="Posición" class="rank-cell"><span class="rank-badge">${i + 1}</span></td>
        <td data-label="Jugador" class="player-name">${p.name}#${p.tag}</td>
        <td data-label="ACS Promedio" class="centered">${p.avgACS.toFixed(2)}</td>
        <td data-label="KDA Promedio" class="centered">${p.avgKDA.toFixed(2)}</td>
        <td data-label="HS%" class="centered">${p.hsPercent.toFixed(2)}%</td>
        <td data-label="First Bloods Promedio" class="centered">${p.avgFirstBloods.toFixed(2)}</td>
        <td data-label="Winrate %" class="centered">${p.winrate.toFixed(2)}%</td>
        <td data-label="Score Compuesto" class="centered">${p.score.toFixed(2)}</td>
      `;
      tbody.appendChild(tr);
    });
  })
  .catch(() => {
    tbody.innerHTML =
      '<tr><td colspan="8" style="color:#ff4655; text-align:center;">Error cargando leaderboard</td></tr>';
  });
