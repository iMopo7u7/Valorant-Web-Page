const API_URL = "https://valorant-10-mans.onrender.com";

// --- Cargar jugadores ---
let allPlayers = [];
async function loadPlayers() {
  try {
    const res = await fetch(`${API_URL}/players`);
    allPlayers = await res.json();
    updatePlayersTable();
    populateTeamSelectors();
    updateDashboard();
  } catch (err) {
    console.error(err);
  }
}

// --- Actualizar tabla de jugadores ---
function updatePlayersTable() {
  const tbody = document.getElementById("playersTableBody");
  tbody.innerHTML = "";
  if (!allPlayers.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center">No hay jugadores registrados</td></tr>`;
    return;
  }

  allPlayers.forEach(p => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><input type="text" value="${p.name}" class="edit-name"></td>
      <td><input type="text" value="${p.tag}" class="edit-tag"></td>
      <td>${p.matchesPlayed || 0}</td>
      <td>${p.totalKills || 0}</td>
      <td>${p.totalDeaths || 0}</td>
      <td>${p.totalAssists || 0}</td>
      <td>
        <button class="btn-update">Guardar</button>
        <button class="btn-delete">Eliminar</button>
      </td>
    `;
    tbody.appendChild(row);

    // Guardar cambios
    row.querySelector(".btn-update").addEventListener("click", async () => {
      const newName = row.querySelector(".edit-name").value.trim();
      const newTag = row.querySelector(".edit-tag").value.trim();
      if (!newName || !newTag) return alert("Nombre y tag requeridos");

      try {
        const res = await fetch(`${API_URL}/players`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ oldName: p.name, oldTag: p.tag, newName, newTag })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al actualizar jugador");
        alert(data.message);
        loadPlayers();
      } catch (err) {
        alert(err.message);
      }
    });

    // Eliminar jugador
    row.querySelector(".btn-delete").addEventListener("click", async () => {
      if (!confirm("¿Eliminar jugador? Esto también lo quitará de todas las partidas")) return;
      try {
        const res = await fetch(`${API_URL}/players`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: p.name, tag: p.tag })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al eliminar jugador");
        alert(data.message);
        loadPlayers();
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

// --- Actualizar dashboard ---
async function updateDashboard() {
  document.getElementById("totalPlayers").innerText = allPlayers.length;

  try {
    const matchesRes = await fetch(`${API_URL}/matches-count`);
    const matchesData = await matchesRes.json();
    document.getElementById("totalMatches").innerText = matchesData.count || 0;
  } catch {
    document.getElementById("totalMatches").innerText = 0;
  }
}

// --- Generar selects para teams ---
function populateTeamSelectors() {
  const teamA = document.getElementById("teamA");
  const teamB = document.getElementById("teamB");
  teamA.innerHTML = "";
  teamB.innerHTML = "";

  const createRow = () => {
    const row = document.createElement("div");
    row.className = "player-row";
    row.innerHTML = `
      <select class="player-select">
        <option value="">-- Selecciona jugador --</option>
        ${allPlayers.map(p => `<option value="${p.name}||${p.tag}">${p.name} (${p.tag})</option>`).join("")}
      </select>
      <input type="number" placeholder="Kills" class="kill" min="0">
      <input type="number" placeholder="Deaths" class="death" min="0">
      <input type="number" placeholder="Assists" class="assist" min="0">
      <input type="number" placeholder="ACS" class="acs" min="0">
      <input type="number" placeholder="FirstBloods" class="fb" min="0">
      <input type="number" placeholder="HS%" class="hs" min="0" max="100">
    `;
    return row;
  };

  for (let i = 0; i < 5; i++) {
    teamA.appendChild(createRow());
    teamB.appendChild(createRow());
  }

  // Evitar duplicados en selects del mismo equipo
  const updateSelectOptions = (team) => {
    const selects = Array.from(team.querySelectorAll(".player-select"));
    const selectedValues = selects.map(s => s.value).filter(v => v !== "");
    selects.forEach(s => {
      Array.from(s.options).forEach(opt => {
        if (opt.value === "") return;
        opt.disabled = selectedValues.includes(opt.value) && s.value !== opt.value;
      });
    });
  };

  [teamA, teamB].forEach(team => {
    const selects = Array.from(team.querySelectorAll(".player-select"));
    selects.forEach(s => s.addEventListener("change", () => updateSelectOptions(team)));
  });
}

// --- Registrar partida ---
document.getElementById("submitMatchBtn").addEventListener("click", async () => {
  const winnerTeam = document.getElementById("winnerTeam").value;
  if (!winnerTeam) return alert("Selecciona el equipo ganador");

  const match = [];
  const teamA = document.getElementById("teamA").querySelectorAll(".player-row");
  const teamB = document.getElementById("teamB").querySelectorAll(".player-row");

  for (const row of [...teamA, ...teamB]) {
    const select = row.querySelector(".player-select");
    const [name, tag] = select.value.split("||");
    const kills = parseInt(row.querySelector(".kill").value) || 0;
    const deaths = parseInt(row.querySelector(".death").value) || 0;
    const assists = parseInt(row.querySelector(".assist").value) || 0;
    const acs = parseInt(row.querySelector(".acs").value) || 0;
    const firstBloods = parseInt(row.querySelector(".fb").value) || 0;
    const hsPercent = parseFloat(row.querySelector(".hs").value) || 0;

    match.push({ name, tag, kills, deaths, assists, acs, firstBloods, hsPercent });
  }

  try {
    const res = await fetch(`${API_URL}/matches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ match, winnerTeam })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error al registrar partida");
    alert(data.message);
    loadPlayers();
  } catch (err) {
    alert(err.message);
  }
});

// --- Inicializar ---
loadPlayers();
