const tbody = document.getElementById("leaderboardBody");

fetch("http://localhost:3000/leaderboard")
  .then((res) => res.json())
  .then((players) => {
    tbody.innerHTML = "";
    if (players.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="6" style="color:#ff4655;">No hay datos para mostrar</td></tr>';
      return;
    }
    players.forEach((p, i) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td data-label="Posición">${i + 1}</td>
        <td data-label="Jugador">${p.name}#${p.tag}</td>
        <td data-label="ACS Promedio">${p.avgACS.toFixed(2)}</td>
        <td data-label="KDA Promedio">${p.avgKDA.toFixed(2)}</td>
        <td data-label="First Bloods Totales">${p.totalFirstBloods}</td>
        <td data-label="Score Compuesto">${p.score.toFixed(2)}</td>
      `;
      tbody.appendChild(tr);
    });
  })
  .catch(() => {
    tbody.innerHTML =
      '<tr><td colspan="6" style="color:#ff4655;">Error cargando leaderboard</td></tr>';
  });
