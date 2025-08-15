const API_URL = "https://valorant-10-mans.onrender.com";

// --- Añadir jugador ---
document.getElementById("addPlayerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("playerName").value.trim();
  const tag = document.getElementById("playerTag").value.trim();

  if (!name || !tag) return alert("Nombre y tag son requeridos");

  try {
    const res = await fetch(`${API_URL}/players`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, tag })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error al añadir jugador");
    alert(data.message);
    e.target.reset();
    loadPlayers();
    loadTotalMatches();
  } catch (err) {
    alert(err.message);
  }
});

// --- Cargar jugadores y actualizar tablas ---
async function loadPlayers() {
  try {
    const res = await fetch(`${API_URL}/players`);
    const players = await res.json();

    const tbody = document.getElementById("playersTableBody");
    tbody.innerHTML = "";

    if (!players.length) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center">No hay jugadores registrados</td></tr>`;
    } else {
      players.forEach((p, i) => {
        const row = document.createElement("tr");
        row.innerHTML = `
          <td>${p.name}</td>
          <td>${p.tag}</td>
          <td>${p.matchesPlayed || 0}</td>
          <td>${p.totalKills || 0}</td>
          <td>${p.totalDeaths || 0}</td>
          <td>${p.totalAssists || 0}</td>
          <td>
            <button class="editBtn">Editar</button>
            <button class="deleteBtn">Eliminar</button>
          </td>
        `;
        tbody.appendChild(row);

        // --- Editar jugador ---
        row.querySelector(".editBtn").addEventListener("click", async () => {
          const newName = prompt("Nuevo nombre:", p.name);
          const newTag = prompt("Nuevo tag:", p.tag);
          if (!newName || !newTag) return;

          try {
            const res = await fetch(`${API_URL}/players/${p._id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: newName, tag: newTag })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Error al actualizar jugador");
            alert(data.message);
            loadPlayers();
          } catch (err) {
            alert(err.message);
          }
        });

        // --- Eliminar jugador ---
        row.querySelector(".deleteBtn").addEventListener("click", async () => {
          if (!confirm(`¿Eliminar al jugador ${p.name}#${p.tag}?`)) return;
          try {
            const res = await fetch(`${API_URL}/players/${p._id}`, { method: "DELETE" });
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

    document.getElementById("totalPlayers").textContent = players.length;

    // --- Cargar jugadores en selects de Team A y B ---
    ["teamAContainer", "teamBContainer"].forEach(teamId => {
      const container = document.getElementById(teamId);
      container.innerHTML = "";
      for (let i = 0; i < 5; i++) {
        const div = document.createElement("div");
        div.className = "player-row";
        div.innerHTML = `
          <select class="playerSelect">
            <option value="">Seleccionar jugador</option>
            ${players.map(p => `<option value="${p.name}#${p.tag}">${p.name}#${p.tag}</option>`).join("")}
          </select>
          <input type="number" class="stat kills" placeholder="Kills" min="0">
          <input type="number" class="stat deaths" placeholder="Deaths" min="0">
          <input type="number" class="stat assists" placeholder="Assists" min="0">
          <input type="number" class="stat acs" placeholder="ACS" min="0">
          <input type="number" class="stat fb" placeholder="First Bloods" min="0">
          <input type="number" class="stat hs" placeholder="HS%" min="0" max="100" step="0.1">
        `;
        container.appendChild(div);
      }
    });

  } catch (err) {
    console.error("Error cargando jugadores:", err);
  }
}

// --- Total de partidas ---
async function loadTotalMatches() {
  try {
    const res = await fetch(`${API_URL}/matches`);
    const matches = await res.json();
    document.getElementById("totalMatches").textContent = matches.length;
  } catch (err) {
    console.error("Error cargando partidas:", err);
  }
}

// --- Enviar partida ---
document.getElementById("submitMatch").addEventListener("click", async () => {
  try {
    const winnerTeam = document.getElementById("winnerTeam").value;
    if (!winnerTeam) return alert("Selecciona equipo ganador");

    const match = [];
    ["teamAContainer", "teamBContainer"].forEach((teamId, index) => {
      const team = document.getElementById(teamId);
      const teamLabel = index === 0 ? "A" : "B";
      Array.from(team.children).forEach(row => {
        const playerVal = row.querySelector(".playerSelect").value;
        if (!playerVal) throw new Error("Selecciona todos los jugadores");
        const [name, tag] = playerVal.split("#");
        match.push({
          name,
          tag,
          kills: parseInt(row.querySelector(".kills").value) || 0,
          deaths: parseInt(row.querySelector(".deaths").value) || 0,
          assists: parseInt(row.querySelector(".assists").value) || 0,
          acs: parseInt(row.querySelector(".acs").value) || 0,
          firstBloods: parseInt(row.querySelector(".fb").value) || 0,
          hsPercent: parseFloat(row.querySelector(".hs").value) || 0
        });
      });
    });

    const res = await fetch(`${API_URL}/matches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ match, winnerTeam })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error al añadir partida");

    alert(data.message);
    loadPlayers();
    loadTotalMatches();
  } catch (err) {
    alert(err.message);
  }
});

// --- Inicializar ---
loadPlayers();
loadTotalMatches();
